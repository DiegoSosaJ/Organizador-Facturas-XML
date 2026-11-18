'use strict';

const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true, // "cfdi:Comprobante" -> "Comprobante", así no importa el prefijo de namespace
  trimValues: true,
});

function leerXml(rutaArchivo) {
  const contenido = fs.readFileSync(rutaArchivo, 'utf8');
  return parser.parse(contenido);
}

/**
 * Recorre recursivamente el objeto (ya parseado del XML) y regresa
 * la PRIMERA ocurrencia del atributo buscado, sin importar en qué nivel/nodo esté.
 */
function buscarAtributo(obj, nombreAtributo) {
  if (obj === null || typeof obj !== 'object') return undefined;

  if (Object.prototype.hasOwnProperty.call(obj, nombreAtributo)) {
    return obj[nombreAtributo];
  }

  for (const key of Object.keys(obj)) {
    const valor = obj[key];
    if (Array.isArray(valor)) {
      for (const item of valor) {
        const encontrado = buscarAtributo(item, nombreAtributo);
        if (encontrado !== undefined) return encontrado;
      }
    } else if (valor && typeof valor === 'object') {
      const encontrado = buscarAtributo(valor, nombreAtributo);
      if (encontrado !== undefined) return encontrado;
    }
  }

  return undefined;
}

/**
 * Igual que buscarAtributo, pero regresa TODAS las ocurrencias encontradas.
 * Se usa para IdDocumento, ya que un pago puede tener más de un documento relacionado.
 */
function buscarTodosAtributos(obj, nombreAtributo, resultados) {
  resultados = resultados || [];
  if (obj === null || typeof obj !== 'object') return resultados;

  if (Object.prototype.hasOwnProperty.call(obj, nombreAtributo)) {
    resultados.push(obj[nombreAtributo]);
  }

  for (const key of Object.keys(obj)) {
    const valor = obj[key];
    if (Array.isArray(valor)) {
      valor.forEach((item) => buscarTodosAtributos(item, nombreAtributo, resultados));
    } else if (valor && typeof valor === 'object') {
      buscarTodosAtributos(valor, nombreAtributo, resultados);
    }
  }

  return resultados;
}

/**
 * Extrae del XML de un CFDI los datos que necesitamos para clasificar y renombrar.
 */
function obtenerDatosCfdi(rutaArchivo) {
  const data = leerXml(rutaArchivo);

  return {
    Fecha: buscarAtributo(data, 'Fecha'),
    Total: buscarAtributo(data, 'Total'),
    UUID: buscarAtributo(data, 'UUID'),
    IdDocumento: buscarTodosAtributos(data, 'IdDocumento', []).filter(Boolean),
    FormaDePagoP: buscarAtributo(data, 'FormaDePagoP'),
    ImporteP: buscarAtributo(data, 'ImporteP'),
    ImpPagado: buscarAtributo(data, 'ImpPagado'),
    FormaPago: buscarAtributo(data, 'FormaPago'),
    // Régimen fiscal del RECEPTOR: solo existe en CFDI 4.0 (en 3.3 viene undefined).
    // No confundir con Emisor@RegimenFiscal, que es el del proveedor.
    RegimenFiscalReceptor: buscarAtributo(data, 'RegimenFiscalReceptor'),
  };
}

module.exports = { leerXml, buscarAtributo, buscarTodosAtributos, obtenerDatosCfdi };
