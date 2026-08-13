import { db, authListo } from "./firebase.js";
import { ref, set, runTransaction, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const form = document.getElementById('encuestaForm');
const formSec = document.getElementById('form-sec');
const qrContainer = document.getElementById('qr-container');
const qrIdText = document.getElementById('qr-id');
const submitBtn = form.querySelector('button[type="submit"]');

const MATRICULA_REGEX = /^\d{2}3110\d{3}$/;
const RFID_REGEX = /^\d{19}$/;

function generarId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'Q' + timestamp + random;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = document.getElementById('nombre').value.trim();
    const matricula = document.getElementById('matricula').value.trim();
    const carrera = document.getElementById('carrera').value;
    const cuatrimestre = document.getElementById('cuatrimestre').value;
    const grupo = document.getElementById('grupo').value;
    const condicion = document.getElementById('pregunta1').value;
    const rfid = document.getElementById('rfid').value.trim();

    if (!nombre || !matricula || !carrera || !cuatrimestre || !grupo || !rfid) {
        alert('Completa todos los campos.');
        return;
    }

    if (!MATRICULA_REGEX.test(matricula)) {
        alert('Matrícula inválida. Formato esperado: AA3110XXX (ejemplo: 253110603)');
        return;
    }

    if (!RFID_REGEX.test(rfid)) {
        alert('La clave trasera de tu credencial debe tener exactamente 19 dígitos numéricos.');
        return;
    }

    const grado = cuatrimestre + grupo;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Verificando...';

    const idCodigoQR = generarId();
    const matriculaRef = ref(db, 'matriculas_activas/' + matricula);
    const inventarioRef = ref(db, 'control_inventario/balones_disponibles');

    // ============================================================
    // FASE 1: escrituras a Firebase (matrícula, inventario, préstamo).
    // Si algo falla AQUÍ, es un error real de datos/conexión/permisos.
    // ============================================================
    try {
        await authListo;

        const resultadoReserva = await runTransaction(matriculaRef, (idExistente) => {
            if (idExistente !== null) {
                return;
            }
            return idCodigoQR;
        });

        if (!resultadoReserva.committed) {
            alert('Ya tienes un préstamo activo. Debes devolver el balón antes de solicitar otro.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Generar mi pase QR';
            return;
        }

        let resultadoInventario;
        try {
            resultadoInventario = await runTransaction(inventarioRef, (disponibles) => {
                return (disponibles || 0) - 1;
            });
        } catch (errInventario) {
            resultadoInventario = { committed: false };
        }

        if (!resultadoInventario.committed) {
            await remove(matriculaRef);
            alert('No hay balones disponibles en este momento. Intenta más tarde.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Generar mi pase QR';
            return;
        }

        await set(ref(db, 'prestamos/' + idCodigoQR), {
            nombre,
            matricula,
            rfid,
            carrera,
            grado,
            condicion_reportada: condicion,
            estado: 0,
            hora_registro: new Date().toISOString()
        });

    } catch (err) {
        // Este catch SOLO cubre fallas reales de guardado (red, permisos,
        // reglas de Firebase). Si truena aquí, tus datos NO se guardaron.
        console.error('Error al registrar el préstamo (Firebase):', err);
        alert('Hubo un error al registrar tu préstamo. Verifica tu conexión e intenta de nuevo.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Generar mi pase QR';
        return;
    }

    // ============================================================
    // FASE 2: solo la parte visual (dibujar el QR en pantalla).
    // Si esto falla, tus datos YA se guardaron en Firebase — el error
    // es nada más que no se pudo mostrar el QR, no hay que asustar al
    // alumno con un mensaje que suene a que perdió su registro.
    // ============================================================
    try {
        formSec.style.display = 'none';
        qrContainer.style.display = 'flex';
        qrIdText.textContent = 'ID: ' + idCodigoQR;

        document.getElementById('qrcode').innerHTML = '';
        new QRCode(document.getElementById('qrcode'), {
            text: idCodigoQR,
            width: 200,
            height: 200
        });
    } catch (errVisual) {
        console.error('Tu préstamo SÍ se guardó, pero no se pudo dibujar el QR en pantalla:', errVisual);
        qrIdText.textContent = 'Tu préstamo quedó registrado. ID: ' + idCodigoQR +
            ' (anótalo, hubo un problema mostrando el código QR — avisa al encargado)';
    }
});
