'use strict';

var express = require('express');
var router = express.Router();
var path = require('path');
var excelService = require('../services/excelService');
var organizerService = require('../services/organizerService');
var clienteService = require('../services/clienteService');

// Cache en memoria del proceso: guarda, por carpeta seleccionada, las filas de los
// Excel ya leídas y los "planes" generados en la vista previa de cada proceso.
// No hay base de datos: esto solo vive mientras la app está abierta.
var cacheCarpetas = new Map();

// Cache del plan de "búsqueda de pagos entre distintos meses" (una sola operación
// a la vez, es una app de un solo usuario).
var planMultiCarpetaPendiente = null;

function obtenerCache(carpeta) {
  if (!cacheCarpetas.has(carpeta)) {
    cacheCarpetas.set(carpeta, {
      filasEmitidos: null,
      filasRecibidos: null,
      pagosConfirmado: false,
      planPagos: null,
      planEgresos: null,
      planIngresos: null,
    });
  }
  return cacheCarpetas.get(carpeta);
}

// ---------------------------------------------------------------------
// Cargar Excels (Emitidos y Recibidos)
// ---------------------------------------------------------------------
router.post('/cargar-excels', function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };

  try {
    var carpeta = req.body.carpeta;
    if (!carpeta) {
      response.meta.message = 'No se recibió la carpeta.';
      return res.json(response);
    }

    var rutas = excelService.encontrarExcels(carpeta);
    if (!rutas.emitidos || !rutas.recibidos) {
      response.meta.message =
        'No se encontraron ambos archivos Excel (el nombre debe contener "emitid" o "recibid"). ' +
        'Archivos .xlsx encontrados en la carpeta: ' + (rutas.encontrados.join(', ') || 'ninguno');
      return res.json(response);
    }

    var filasEmitidos = excelService.leerExcel(rutas.emitidos);
    var filasRecibidos = excelService.leerExcel(rutas.recibidos);

    var cache = obtenerCache(carpeta);
    cache.filasEmitidos = filasEmitidos;
    cache.filasRecibidos = filasRecibidos;
    // Si se vuelven a cargar los Excel, se reinician los planes/confirmaciones previas
    cache.pagosConfirmado = false;
    cache.planPagos = null;
    cache.planEgresos = null;
    cache.planIngresos = null;

    response.meta.success = true;
    response.meta.message = 'Excels cargados correctamente.';
    response.data = {
      emitidos: { archivo: path.basename(rutas.emitidos), filas: filasEmitidos.length },
      recibidos: { archivo: path.basename(rutas.recibidos), filas: filasRecibidos.length },
    };
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al cargar los Excel: ' + err.message;
    res.json(response);
  }
});

function requiereExcelsCargados(carpeta, response) {
  var cache = obtenerCache(carpeta);
  if (!cache.filasEmitidos || !cache.filasRecibidos) {
    response.meta.message = 'Primero debes cargar los archivos Excel de esta carpeta.';
    return null;
  }
  return cache;
}

// ---------------------------------------------------------------------
// PAGOS
// ---------------------------------------------------------------------
router.post('/pagos/preview', function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };
  try {
    var carpeta = req.body.carpeta;
    var cache = requiereExcelsCargados(carpeta, response);
    if (!cache) return res.json(response);

    var plan = organizerService.planificarPagos(carpeta, cache.filasRecibidos);
    cache.planPagos = plan;

    response.meta.success = true;
    response.data = {
      total: plan.total,
      conComplemento: plan.conComplemento.length,
      sinComplemento: plan.sinComplemento.length,
      noEncontradosEnCarpeta: plan.noEncontradosEnCarpeta.length,
      detalle: {
        conComplemento: plan.conComplemento.map(function (i) {
          return {
            uuid: i.uuid,
            archivoPago: path.basename(i.rutaPago),
            carpetaDestino: i.nombreCarpeta,
            complementos: i.complementos.map(function (c) {
              return { uuid: c.idDocumento, archivo: path.basename(c.ruta) };
            }),
          };
        }),
        sinComplemento: plan.sinComplemento.map(function (i) {
          return { uuid: i.uuid, archivoPago: path.basename(i.rutaPago), idsBuscados: i.datosPago.IdDocumento || [] };
        }),
        noEncontradosEnCarpeta: plan.noEncontradosEnCarpeta.map(function (i) { return { uuid: i.uuid }; }),
      },
    };
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al previsualizar Pagos: ' + err.message;
    res.json(response);
  }
});

router.post('/pagos/confirmar', function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };
  try {
    var carpeta = req.body.carpeta;
    var cache = obtenerCache(carpeta);
    if (!cache.planPagos) {
      response.meta.message = 'Primero debes generar la vista previa de Pagos.';
      return res.json(response);
    }

    var resumen = organizerService.ejecutarPagos(carpeta, cache.planPagos);
    cache.pagosConfirmado = true;
    cache.planPagos = null;

    response.meta.success = true;
    response.meta.message = 'Pagos organizados correctamente.';
    response.data = resumen;
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al confirmar Pagos: ' + err.message;
    res.json(response);
  }
});

// ---------------------------------------------------------------------
// EGRESOS (requiere que Pagos ya haya sido confirmado)
// ---------------------------------------------------------------------
router.post('/egresos/preview', function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };
  try {
    var carpeta = req.body.carpeta;
    var cache = requiereExcelsCargados(carpeta, response);
    if (!cache) return res.json(response);

    if (!cache.pagosConfirmado) {
      response.meta.message = 'Debes ejecutar y confirmar "Buscar Pagos" antes de buscar Egresos.';
      return res.json(response);
    }

    // El régimen del cliente es obligatorio: sin él no se puede decidir qué va a "Otro regimen".
    var info = clienteService.obtenerClienteConCatalogo(req.body.clienteId);
    if (!info.cliente) {
      response.meta.message = 'Selecciona o crea el cliente (con su régimen fiscal) antes de buscar Egresos.';
      return res.json(response);
    }

    var plan = organizerService.planificarEgresos(carpeta, cache.filasRecibidos, info.cliente, info.catalogo);
    cache.planEgresos = plan;

    var delCliente = plan.encontrados.filter(function (i) { return i.categoria === 'cliente'; });
    var sinRegimen = plan.encontrados.filter(function (i) { return i.categoria === 'sinRegimen'; });
    var otros = plan.encontrados.filter(function (i) { return i.categoria === 'otro'; });

    // Agrupa los de otro régimen por carpeta destino, para mostrar "Otro regimen (X)": N archivos
    var gruposOtro = {};
    otros.forEach(function (i) {
      gruposOtro[i.carpetaOtroRegimen] = (gruposOtro[i.carpetaOtroRegimen] || 0) + 1;
    });

    response.meta.success = true;
    response.data = {
      total: plan.total,
      encontrados: plan.encontrados.length,
      enRegimenCliente: delCliente.length,
      otroRegimen: otros.length,
      sinRegimenEnXml: sinRegimen.length,
      noEncontrados: plan.noEncontrados.length,
      detalle: {
        cliente: { nombre: plan.cliente.nombre, regimenCodigo: plan.cliente.regimenCodigo },
        otroRegimen: Object.keys(gruposOtro).map(function (carpetaOtro) {
          return { carpeta: carpetaOtro, cantidad: gruposOtro[carpetaOtro] };
        }),
        noEncontrados: plan.noEncontrados.map(function (i) { return { uuid: i.uuid }; }),
      },
    };
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al previsualizar Egresos: ' + err.message;
    res.json(response);
  }
});

router.post('/egresos/confirmar', function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };
  try {
    var carpeta = req.body.carpeta;
    var cache = obtenerCache(carpeta);
    if (!cache.planEgresos) {
      response.meta.message = 'Primero debes generar la vista previa de Egresos.';
      return res.json(response);
    }

    var resumen = organizerService.ejecutarEgresos(carpeta, cache.planEgresos);
    cache.planEgresos = null;

    response.meta.success = true;
    response.meta.message = 'Egresos organizados correctamente.';
    response.data = resumen;
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al confirmar Egresos: ' + err.message;
    res.json(response);
  }
});

// ---------------------------------------------------------------------
// INGRESOS (independiente)
// ---------------------------------------------------------------------
router.post('/ingresos/preview', function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };
  try {
    var carpeta = req.body.carpeta;
    var cache = requiereExcelsCargados(carpeta, response);
    if (!cache) return res.json(response);

    var plan = organizerService.planificarIngresos(carpeta, cache.filasEmitidos);
    cache.planIngresos = plan;

    response.meta.success = true;
    response.data = {
      total: plan.total,
      normales: plan.normales.length,
      cancelados: plan.cancelados.length,
      noEncontrados: plan.noEncontrados.length,
      detalle: {
        normales: plan.normales.map(function (i) { return { uuid: i.uuid }; }),
        cancelados: plan.cancelados.map(function (i) { return { uuid: i.uuid }; }),
        noEncontrados: plan.noEncontrados.map(function (i) { return { uuid: i.uuid }; }),
      },
    };
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al previsualizar Ingresos: ' + err.message;
    res.json(response);
  }
});

router.post('/ingresos/confirmar', function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };
  try {
    var carpeta = req.body.carpeta;
    var cache = obtenerCache(carpeta);
    if (!cache.planIngresos) {
      response.meta.message = 'Primero debes generar la vista previa de Ingresos.';
      return res.json(response);
    }

    var resumen = organizerService.ejecutarIngresos(carpeta, cache.planIngresos);
    cache.planIngresos = null;

    response.meta.success = true;
    response.meta.message = 'Ingresos organizados correctamente.';
    response.data = resumen;
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al confirmar Ingresos: ' + err.message;
    res.json(response);
  }
});

// ---------------------------------------------------------------------
// BÚSQUEDA DE PAGOS ENTRE MÚLTIPLES CARPETAS (distintos meses)
// ---------------------------------------------------------------------
router.post('/pagos-multiples/preview', function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };
  try {
    var carpetas = req.body.carpetas;
    if (!Array.isArray(carpetas) || carpetas.length < 2) {
      response.meta.message = 'Selecciona al menos 2 carpetas de meses distintos.';
      return res.json(response);
    }

    var plan = organizerService.planificarPagosMultiplesCarpetas(carpetas);
    planMultiCarpetaPendiente = plan;

    var totalPendientes = 0, totalEncontrados = 0, totalSiguenSinEncontrarse = 0;

    var detallePorCarpeta = plan.map(function (grupo) {
      totalPendientes += grupo.totalPendientes;
      totalEncontrados += grupo.encontrados.length;
      totalSiguenSinEncontrarse += grupo.siguenSinEncontrarse.length;

      return {
        carpeta: grupo.carpeta,
        totalPendientes: grupo.totalPendientes,
        encontrados: grupo.encontrados.map(function (i) {
          var carpetaContenedora = path.join(i.complementos[0].carpetaOrigen, 'Pagos');
          return {
            uuid: i.uuid,
            archivoPago: path.basename(i.rutaPago),
            mesPago: path.basename(grupo.carpeta),
            nombreSubcarpeta: i.nombreCarpeta,
            seCrearaDentroDe: carpetaContenedora,
            mesDestino: path.basename(i.complementos[0].carpetaOrigen),
            variosComplementos: i.complementos.length > 1,
            complementosEncontradosEn: i.complementos.map(function (c) {
              return {
                idDocumento: c.idDocumento,
                archivo: path.basename(c.ruta),
                carpetaOrigen: c.carpetaOrigen,
                mes: path.basename(c.carpetaOrigen),
              };
            }),
          };
        }),
        siguenSinEncontrarse: grupo.siguenSinEncontrarse.map(function (i) {
          return { uuid: i.uuid, archivoPago: path.basename(i.rutaPago), idsBuscados: i.idsBuscados || [] };
        }),
      };
    });

    response.meta.success = true;
    response.data = {
      totalPendientes: totalPendientes,
      totalEncontrados: totalEncontrados,
      totalSiguenSinEncontrarse: totalSiguenSinEncontrarse,
      porCarpeta: detallePorCarpeta,
    };
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al previsualizar la búsqueda entre carpetas: ' + err.message;
    res.json(response);
  }
});

router.post('/pagos-multiples/confirmar', function (req, res) {
  var response = { meta: { success: false, message: '' }, data: {} };
  try {
    if (!planMultiCarpetaPendiente) {
      response.meta.message = 'Primero debes generar la vista previa de la búsqueda entre carpetas.';
      return res.json(response);
    }

    var resumen = organizerService.ejecutarPagosMultiplesCarpetas(planMultiCarpetaPendiente);
    planMultiCarpetaPendiente = null;

    response.meta.success = true;
    response.meta.message = 'Búsqueda entre carpetas completada.';
    response.data = resumen;
    res.json(response);
  } catch (err) {
    response.meta.message = 'Error al confirmar la búsqueda entre carpetas: ' + err.message;
    res.json(response);
  }
});

module.exports = router;
