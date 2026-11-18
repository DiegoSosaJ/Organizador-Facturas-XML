'use strict';

var express = require('express');
var router = express.Router();
var ingresosExcelService = require('../services/ingresosExcelService');
var clienteService = require('../services/clienteService');

router.post('/rellenar', async function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };

  try {
    var rutaMaestro = req.body.rutaMaestro;
    var rutaGuardar = req.body.rutaGuardar;
    var archivosEmitidos = req.body.archivosEmitidos;

    if (!rutaMaestro) {
      response.meta.message = 'Selecciona el Excel de Ingresos (12 pestañas).';
      return res.json(response);
    }
    if (!Array.isArray(archivosEmitidos) || !archivosEmitidos.length) {
      response.meta.message = 'Selecciona al menos un Excel de Emitidos.';
      return res.json(response);
    }
    if (!rutaGuardar) {
      response.meta.message = 'No se indicó dónde guardar el Excel resultante.';
      return res.json(response);
    }

    // El régimen emisor que se filtra en los Emitidos es el del cliente elegido (cada cliente tiene el suyo)
    var info = clienteService.obtenerClienteConCatalogo(req.body.clienteId);
    if (!info.cliente) {
      response.meta.message = 'Selecciona el cliente (con su régimen fiscal): el llenado filtra los Emitidos con ese régimen.';
      return res.json(response);
    }

    var anio = req.body.anio;
    if (!/^\d{4}$/.test(String(anio || '').trim())) {
      response.meta.message = 'Indica el año (4 dígitos, ej. 2026): se usa para renombrar las pestañas.';
      return res.json(response);
    }

    var resultado = await ingresosExcelService.rellenarExcelIngresos(rutaMaestro, archivosEmitidos, { anio: anio, regimenCodigo: info.cliente.regimenCodigo });
    await resultado.workbook.xlsx.writeFile(rutaGuardar);

    response.meta.success = true;
    response.meta.message = 'Excel de Ingresos generado correctamente.';
    response.data = Object.assign({ rutaGuardado: rutaGuardar, cliente: info.cliente.nombre, regimenCodigo: info.cliente.regimenCodigo }, resultado.resumen);
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al rellenar el Excel: ' + err.message;
    res.json(response);
  }
});

module.exports = router;
