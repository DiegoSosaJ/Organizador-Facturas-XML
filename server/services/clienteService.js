'use strict';

const fs = require('fs');
const path = require('path');

// Los clientes y el catálogo de regímenes se guardan en un JSON dentro de la carpeta de datos
// del usuario (main.js define CFDI_DATA_DIR = app.getPath('userData')). Así sobreviven a
// cerrar el programa y a reinstalarlo/actualizarlo. Sin CFDI_DATA_DIR (p. ej. pruebas) se usa ./data.
function rutaArchivo() {
  const dir = process.env.CFDI_DATA_DIR || path.join(__dirname, '..', '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'clientes.json');
}

// Catálogo c_RegimenFiscal del SAT como punto de partida. El usuario puede agregar los suyos
// (p. ej. "512 - Transporte"); el programa nunca exige que el código esté en este catálogo.
const REGIMENES_SAT = [
  ['601', 'General de Ley Personas Morales'],
  ['603', 'Personas Morales con Fines no Lucrativos'],
  ['605', 'Sueldos y Salarios e Ingresos Asimilados a Salarios'],
  ['606', 'Arrendamiento'],
  ['607', 'Régimen de Enajenación o Adquisición de Bienes'],
  ['608', 'Demás ingresos'],
  ['610', 'Residentes en el Extranjero sin Establecimiento Permanente en México'],
  ['611', 'Ingresos por Dividendos (socios y accionistas)'],
  ['612', 'Personas Físicas con Actividades Empresariales y Profesionales'],
  ['614', 'Ingresos por intereses'],
  ['615', 'Régimen de los ingresos por obtención de premios'],
  ['616', 'Sin obligaciones fiscales'],
  ['620', 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos'],
  ['621', 'Incorporación Fiscal'],
  ['622', 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras'],
  ['623', 'Opcional para Grupos de Sociedades'],
  ['624', 'Coordinados'],
  ['625', 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas'],
  ['626', 'Régimen Simplificado de Confianza'],
].map(function (r) { return { codigo: r[0], nombre: r[1] }; });

function leer() {
  const ruta = rutaArchivo();
  if (fs.existsSync(ruta)) {
    try {
      const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      return {
        regimenes: Array.isArray(datos.regimenes) ? datos.regimenes : [],
        clientes: Array.isArray(datos.clientes) ? datos.clientes : [],
      };
    } catch (err) {
      // Archivo dañado: se conserva una copia y se arranca limpio en vez de perder el programa.
      try { fs.copyFileSync(ruta, ruta + '.dañado'); } catch (e) { /* ignorar */ }
    }
  }
  return { regimenes: REGIMENES_SAT.slice(), clientes: [] };
}

function guardar(datos) {
  const ruta = rutaArchivo();
  const tmp = ruta + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2), 'utf8');
  fs.renameSync(tmp, ruta); // escritura atómica: no queda a medias si se cierra la app
}

function limpiarTexto(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim().replace(/\s+/g, ' ');
}

function validarCodigo(codigo) {
  const c = limpiarTexto(codigo);
  if (!/^\d{2,4}$/.test(c)) throw new Error('El número de régimen debe ser numérico (ej. 612).');
  return c;
}

function obtenerTodo() {
  const datos = leer();
  datos.regimenes.sort(function (a, b) { return a.codigo.localeCompare(b.codigo); });
  datos.clientes.sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
  return datos;
}

function crearRegimen(codigo, nombre) {
  const c = validarCodigo(codigo);
  const n = limpiarTexto(nombre);
  if (!n) throw new Error('Escribe el nombre del régimen.');
  const datos = leer();
  if (datos.regimenes.some(function (r) { return r.codigo === c; })) {
    throw new Error('Ya existe el régimen ' + c + '.');
  }
  datos.regimenes.push({ codigo: c, nombre: n });
  guardar(datos);
  return { codigo: c, nombre: n };
}

function crearCliente(nombre, regimenCodigo) {
  const n = limpiarTexto(nombre);
  if (!n) throw new Error('Escribe el nombre del cliente.');
  const c = validarCodigo(regimenCodigo);
  const datos = leer();
  if (!datos.regimenes.some(function (r) { return r.codigo === c; })) {
    throw new Error('El régimen ' + c + ' no existe. Agrégalo primero.');
  }
  if (datos.clientes.some(function (x) { return x.nombre.toLowerCase() === n.toLowerCase(); })) {
    throw new Error('Ya existe un cliente con ese nombre.');
  }
  const cliente = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nombre: n, regimenCodigo: c };
  datos.clientes.push(cliente);
  guardar(datos);
  return cliente;
}

function actualizarCliente(id, cambios) {
  const datos = leer();
  const cliente = datos.clientes.find(function (x) { return x.id === id; });
  if (!cliente) throw new Error('El cliente no existe.');

  if (cambios.nombre !== undefined) {
    const n = limpiarTexto(cambios.nombre);
    if (!n) throw new Error('Escribe el nombre del cliente.');
    if (datos.clientes.some(function (x) { return x.id !== id && x.nombre.toLowerCase() === n.toLowerCase(); })) {
      throw new Error('Ya existe un cliente con ese nombre.');
    }
    cliente.nombre = n;
  }
  if (cambios.regimenCodigo !== undefined) {
    const c = validarCodigo(cambios.regimenCodigo);
    if (!datos.regimenes.some(function (r) { return r.codigo === c; })) {
      throw new Error('El régimen ' + c + ' no existe. Agrégalo primero.');
    }
    cliente.regimenCodigo = c;
  }
  guardar(datos);
  return cliente;
}

function eliminarCliente(id) {
  const datos = leer();
  const antes = datos.clientes.length;
  datos.clientes = datos.clientes.filter(function (x) { return x.id !== id; });
  if (datos.clientes.length === antes) throw new Error('El cliente no existe.');
  guardar(datos);
}

// Regresa { cliente, catalogo } donde catalogo es { '612': 'Personas Físicas...' }.
function obtenerClienteConCatalogo(id) {
  const datos = leer();
  const cliente = datos.clientes.find(function (x) { return x.id === id; });
  const catalogo = {};
  datos.regimenes.forEach(function (r) { catalogo[r.codigo] = r.nombre; });
  return { cliente: cliente || null, catalogo: catalogo };
}

module.exports = {
  obtenerTodo,
  crearRegimen,
  crearCliente,
  actualizarCliente,
  eliminarCliente,
  obtenerClienteConCatalogo,
};
