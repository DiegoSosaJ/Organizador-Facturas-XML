'use strict';

var express = require('express');
var router = express.Router();
var clienteService = require('../services/clienteService');

// Envuelve cada handler con el formato { meta: { success, message }, data } del proyecto.
// Los errores de validación (mensajes del servicio) se regresan como success:false.
function manejar(fn, mensajeOk) {
  return function (req, res) {
    var response = { meta: { success: false, message: '' }, data: {} };
    try {
      response.data = fn(req) || {};
      response.meta.success = true;
      response.meta.message = mensajeOk || '';
      res.json(response);
    } catch (err) {
      response.meta.message = err.message;
      res.json(response);
    }
  };
}

router.get('/', manejar(function () {
  return clienteService.obtenerTodo();
}));

router.post('/regimenes', manejar(function (req) {
  return clienteService.crearRegimen(req.body.codigo, req.body.nombre);
}, 'Régimen guardado.'));

router.post('/', manejar(function (req) {
  return clienteService.crearCliente(req.body.nombre, req.body.regimenCodigo);
}, 'Cliente guardado.'));

router.post('/:id/actualizar', manejar(function (req) {
  return clienteService.actualizarCliente(req.params.id, {
    nombre: req.body.nombre,
    regimenCodigo: req.body.regimenCodigo,
  });
}, 'Cliente actualizado.'));

router.post('/:id/eliminar', manejar(function (req) {
  clienteService.eliminarCliente(req.params.id);
  return {};
}, 'Cliente eliminado.'));

module.exports = router;
