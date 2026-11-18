'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

/**
 * Lee un archivo .xlsx y devuelve un arreglo de objetos (una fila = un objeto),
 * usando la primera fila del archivo como encabezados (nombres de columna).
 */
function leerExcel(rutaArchivo) {
  const workbook = XLSX.readFile(rutaArchivo);
  const nombreHoja = workbook.SheetNames[0];
  const hoja = workbook.Sheets[nombreHoja];
  return XLSX.utils.sheet_to_json(hoja, { defval: '', raw: false });
}

/**
 * Busca en la carpeta seleccionada los archivos .xlsx de "Emitidos" y "Recibidos".
 * Se identifican por el nombre del archivo (debe contener "emitid" o "recibid",
 * sin importar mayúsculas/minúsculas). Si no los encuentra, regresa null en esos campos.
 */
function encontrarExcels(carpeta) {
  const archivos = fs.readdirSync(carpeta).filter((f) => /\.xlsx?$/i.test(f));

  const emitidos = archivos.find((f) => /emitid/i.test(f));
  const recibidos = archivos.find((f) => /recibid/i.test(f));

  return {
    emitidos: emitidos ? path.join(carpeta, emitidos) : null,
    recibidos: recibidos ? path.join(carpeta, recibidos) : null,
    encontrados: archivos,
  };
}

module.exports = { leerExcel, encontrarExcels };
