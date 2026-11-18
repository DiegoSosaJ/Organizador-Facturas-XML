'use strict';

const express = require('express');
const path = require('path');
const cfdiRoutes = require('./routes/cfdi.routes');
const ingresosExcelRoutes = require('./routes/ingresosExcel.routes');
const clientesRoutes = require('./routes/clientes.routes');

function crearApp() {
  const app = express();

  app.use(express.json({ limit: '50mb' }));

  // Frontend (Angular)
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Permite referenciar angular / angular-resource directo desde node_modules
  // (ej. <script src="/angular/angular.js">)
  app.use(express.static(path.join(__dirname, '..', 'node_modules')));

  app.use('/api/cfdi', cfdiRoutes);
  app.use('/api/ingresos-excel', ingresosExcelRoutes);
  app.use('/api/clientes', clientesRoutes);

  // Manejo de errores no controlados
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ meta: { success: false, message: 'Error interno del servidor.' }, data: {} });
  });

  return app;
}

module.exports = crearApp;
