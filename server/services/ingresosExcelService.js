'use strict';

const path = require('path');
const XLSX = require('xlsx'); // para leer los Excel de "Emitidos" (tablas planas, como en el resto de la app)
const ExcelJS = require('exceljs'); // para leer/escribir el Excel maestro de 12 pestañas SIN perder su formato

const MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];

// Encabezados que se buscan en cada pestaña del Excel maestro para ubicar la fila
// de títulos y las columnas correspondientes, sin importar en qué fila/orden estén.
// Todas se escriben (incluida IVA); "VENTAS 0%" no tiene columna de origen por
// ahora, así que solo se limpia (queda vacía) pero no se le escribe nada.
const ENCABEZADOS_ESPERADOS = [
  'FECHA', 'FOLIO', 'CLIENTE', 'FORMA DE PAGO', 'RFC',
  'VENTAS 0%', 'VENTAS 16%', 'IVA', 'TOTAL',
];

const ENCABEZADOS_A_ESCRIBIR = ENCABEZADOS_ESPERADOS;

function quitarAcentos(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizar(texto) {
  return quitarAcentos(texto).trim().toUpperCase();
}

// Determina a qué mes corresponde un archivo según cómo EMPIECE su nombre
// (acepta mayúsculas, minúsculas, camelCase, guiones, sufijos, etc.)
function detectarMes(rutaArchivo) {
  const base = normalizar(path.basename(rutaArchivo, path.extname(rutaArchivo)));
  return MESES.find((mes) => base.startsWith(mes)) || null;
}

// Extrae el código inicial de un valor tipo "612 - Personas Físicas..." -> "612"
function extraerCodigo(valor) {
  const texto = String(valor || '').trim();
  const m = /^(\d+)/.exec(texto);
  return m ? m[1] : texto;
}

function esVigente(valor) {
  return /^VIGENTE/i.test(String(valor || '').trim());
}

// Regresa TODAS las columnas de una fila cuyo nombre EMPIECE con el prefijo dado,
// sin importar mayúsculas/acentos.
function buscarColumnasPorPrefijo(fila, prefijo) {
  const prefijoNormalizado = normalizar(prefijo);
  return Object.keys(fila).filter((clave) => normalizar(clave).startsWith(prefijoNormalizado));
}

// Lee el Excel de "Emitidos" de un mes y regresa solo las filas que cumplen el
// filtro (Estado VIGENTE y Regimen emisor = el del cliente), ya mapeadas a las columnas del
// Excel de Ingresos.
function leerYFiltrarEmitidos(rutaArchivo, regimenCodigo) {
  const workbook = XLSX.readFile(rutaArchivo);
  const hoja = workbook.Sheets[workbook.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { defval: '', raw: false });

  return filas
    .filter((f) => esVigente(f['Estado']) && extraerCodigo(f['Regimen emisor']) === regimenCodigo)
    .map((f) => {
      const montos = calcularMontos(f);
      return {
        FECHA: f['Fecha emision'] || '',
        FOLIO: f['UUID'] || '',
        CLIENTE: f['Razon receptor'] || '',
        'FORMA DE PAGO': f['Forma pago'] || '',
        RFC: f['RFC receptor'] || '',
        'VENTAS 0%': montos.ventas0,
        'VENTAS 16%': montos.ventas16,
        IVA: montos.iva,
        TOTAL: aNumero(f['Total']),
      };
    });
}

// Convierte "1,950.00" / "$135" / 135 a número. Si no es numérico, regresa el valor tal cual.
// Los montos deben quedar como número en el Excel (si fueran texto, las SUM no los cuentan).
function aNumero(valor) {
  if (typeof valor === 'number') return valor;
  const texto = String(valor === undefined || valor === null ? '' : valor).replace(/[$,\s]/g, '');
  if (texto === '') return '';
  const n = Number(texto);
  return Number.isFinite(n) ? n : valor;
}

const redondear2 = (n) => Math.round(n * 100) / 100;
const esColumnaCero = (clave) => /(^|[^\d.])0\s*%/.test(clave);

// En el Excel de Emitidos, la columna "IVA Trasladado 0%" trae la BASE de las ventas a tasa 0
// (no un impuesto: p. ej. SubTotal 135 -> "IVA Trasladado 0%" = 135), mientras que
// "IVA Trasladado 16%" trae el IVA en pesos. Por eso:
//   - solo columna 0%      -> VENTAS 0% = base, VENTAS 16% vacío, IVA = 0
//   - columna 16% (o sin tasa en el nombre) -> VENTAS 16% = SubTotal, IVA = esa columna
//   - ambas                -> VENTAS 0% = base 0%, VENTAS 16% = SubTotal - base 0%
function calcularMontos(f) {
  const candidatos = buscarColumnasPorPrefijo(f, 'IVA Trasladado');
  const colCero = candidatos.find(esColumnaCero);
  const otras = candidatos.filter((c) => !esColumnaCero(c));
  const subtotal = aNumero(f['SubTotal']);
  const base0 = colCero ? aNumero(f[colCero]) : '';

  let iva = '';
  if (otras.length) {
    const col = otras.length === 1 ? otras[0] : (otras.find((c) => /16/.test(c)) || otras[0]);
    iva = aNumero(f[col]);
  } else if (colCero) {
    iva = 0;
  }

  let ventas16 = subtotal;
  if (colCero && !otras.length) ventas16 = '';
  else if (colCero && typeof subtotal === 'number' && typeof base0 === 'number') ventas16 = redondear2(subtotal - base0);

  return { ventas0: base0, ventas16, iva };
}

// Busca, entre las primeras filas de una hoja, la que tiene más coincidencias con
// ENCABEZADOS_ESPERADOS (esa es la fila de títulos, sin importar si es la fila 3,
// la 5, o cualquier otra).
function encontrarFilaEncabezados(worksheet) {
  const MAX_FILAS_A_REVISAR = 15;
  const limite = Math.min(MAX_FILAS_A_REVISAR, Math.max(worksheet.rowCount || 0, MAX_FILAS_A_REVISAR));
  let mejorFila = null;
  let mejorConteo = 0;

  for (let f = 1; f <= limite; f++) {
    const row = worksheet.getRow(f);
    let conteo = 0;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const valor = normalizar(cell.value);
      if (ENCABEZADOS_ESPERADOS.some((h) => normalizar(h) === valor)) conteo++;
    });
    if (conteo > mejorConteo) {
      mejorConteo = conteo;
      mejorFila = f;
    }
  }

  // Se exige al menos 3 coincidencias para confiar en que sí es la fila de títulos
  return mejorConteo >= 3 ? mejorFila : null;
}

// Regresa { 'FECHA': numeroDeColumna, 'FOLIO': numeroDeColumna, ... } según lo que
// realmente se encontró en la fila de encabezados (tolera columnas faltantes).
function mapearColumnas(worksheet, filaEncabezados) {
  const row = worksheet.getRow(filaEncabezados);
  const mapa = {};
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const valor = normalizar(cell.value);
    const encabezado = ENCABEZADOS_ESPERADOS.find((h) => normalizar(h) === valor);
    if (encabezado) mapa[encabezado] = colNumber;
  });
  return mapa;
}

function esFormula(valor) {
  return !!valor && typeof valor === 'object' && (valor.formula !== undefined || valor.sharedFormula !== undefined);
}

const RE_SUMA_COLUMNA = /^SUM\(\s*\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i;

// Busca la fila de totales: la primera fila bajo los datos con una celda =SUM(X#:X#) que suma
// una columna ENTERA hacia arriba (mismo X, y termina antes de esa fila). Las fórmulas por fila
// (=SUM(E5:G5)) no cuentan porque terminan en su propia fila. Regresa { fila, finRango } o null.
function encontrarFilaTotales(hoja, desdeFila) {
  const limite = Math.max(hoja.rowCount || 0, desdeFila);
  for (let f = desdeFila; f <= limite; f++) {
    let encontrado = null;
    hoja.getRow(f).eachCell({ includeEmpty: false }, (celda) => {
      const v = celda.value;
      if (!esFormula(v) || typeof v.formula !== 'string') return;
      const m = RE_SUMA_COLUMNA.exec(v.formula.trim());
      if (m && m[1].toUpperCase() === m[3].toUpperCase() && Number(m[4]) < f && Number(m[2]) <= Number(m[4])) {
        encontrado = { fila: f, finRango: Number(m[4]) };
      }
    });
    if (encontrado) return encontrado;
  }
  return null;
}

// Cambia el número de fila de las referencias (E18, $E$18) que apunten a filaOrigen.
function moverFormulaDeFila(formula, filaOrigen, filaNueva) {
  return formula.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (todo, col, fila) => (Number(fila) === filaOrigen ? col + filaNueva : todo));
}

// Inserta `cantidad` filas justo debajo de `ultimaFilaDatos`: copia el formato de esa última fila y
// las fórmulas por fila de la PRIMERA fila de datos, y extiende las sumas de la fila de totales.
function insertarFilasAntesDeTotales(hoja, primeraFilaDatos, ultimaFilaDatos, cantidad, filaTotales) {
  const filaModelo = hoja.getRow(ultimaFilaDatos);
  const filaFormulas = hoja.getRow(primeraFilaDatos);
  const modelo = [];
  filaModelo.eachCell({ includeEmpty: true }, (celda, col) => {
    const v = filaFormulas.getCell(col).value;
    modelo.push({ col, estilo: Object.assign({}, celda.style), formula: esFormula(v) ? v.formula : null });
  });

  hoja.spliceRows(ultimaFilaDatos + 1, 0, ...Array.from({ length: cantidad }, () => []));

  for (let i = 1; i <= cantidad; i++) {
    const fila = hoja.getRow(ultimaFilaDatos + i);
    if (filaModelo.height) fila.height = filaModelo.height;
    modelo.forEach((m) => {
      const celda = fila.getCell(m.col);
      celda.style = Object.assign({}, m.estilo);
      if (typeof m.formula === 'string') celda.value = { formula: moverFormulaDeFila(m.formula, primeraFilaDatos, ultimaFilaDatos + i) };
    });
  }

  // La fila de totales bajó `cantidad` posiciones: se amplía el final de cada SUM de columna.
  hoja.getRow(filaTotales + cantidad).eachCell({ includeEmpty: false }, (celda) => {
    const v = celda.value;
    if (!esFormula(v) || typeof v.formula !== 'string') return;
    const m = RE_SUMA_COLUMNA.exec(v.formula.trim());
    if (m && Number(m[4]) === ultimaFilaDatos) {
      celda.value = { formula: `SUM(${m[1]}${m[2]}:${m[3]}${ultimaFilaDatos + cantidad})` };
    }
  });
}

// Busca la pestaña del workbook cuyo nombre corresponde al mes dado.
function encontrarHojaDelMes(workbook, mes) {
  return workbook.worksheets.find((ws) => normalizar(ws.name).startsWith(mes)) || null;
}

/**
 * Procesa el Excel maestro (12 pestañas, una por mes): por cada Excel de "Emitidos"
 * recibido, detecta a qué mes corresponde por su nombre de archivo, filtra y mapea
 * sus filas, y las escribe en la pestaña de ese mes, SOBRESCRIBIENDO cualquier dato
 * que ya hubiera ahí (se conserva el formato de las celdas, solo se cambia el valor).
 *
 * No modifica el archivo original en disco: trabaja sobre una copia en memoria del
 * workbook, que quien llame a esta función se encarga de guardar donde el usuario
 * elija.
 */
async function rellenarExcelIngresos(rutaMaestro, rutasArchivosEmitidos, opciones) {
  opciones = opciones || {};
  const regimenCodigo = String(opciones.regimenCodigo || '').trim();
  if (!regimenCodigo) throw new Error('Falta el régimen del cliente para filtrar los Emitidos.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(rutaMaestro);
  // Las fórmulas de la plantilla (TOTAL, totales) se recalculan al abrir el archivo en Excel
  workbook.calcProperties = Object.assign({}, workbook.calcProperties, { fullCalcOnLoad: true });

  const resumen = {
    hojasActualizadas: [],
    archivosNoReconocidos: [],
    hojasNoEncontradas: [],
    hojasRenombradas: [],
  };

  // Si el usuario indicó el año, TODAS las pestañas de mes se renombran a "MES AÑO"
  // (ENERO 2026, FEBRERO 2026...), estén o no entre los meses que se van a llenar.
  if (opciones.anio !== undefined && opciones.anio !== null && String(opciones.anio).trim() !== '') {
    const anio = String(opciones.anio).trim();
    if (!/^\d{4}$/.test(anio)) throw new Error('El año debe tener 4 dígitos (ej. 2026).');

    for (const mes of MESES) {
      const hoja = encontrarHojaDelMes(workbook, mes);
      if (!hoja) continue;
      const nuevoNombre = `${mes} ${anio}`;
      if (hoja.name !== nuevoNombre) {
        const anterior = hoja.name;
        hoja.name = nuevoNombre;
        resumen.hojasRenombradas.push({ de: anterior, a: nuevoNombre });
      }
    }
  }

  for (const rutaArchivo of rutasArchivosEmitidos) {
    const mes = detectarMes(rutaArchivo);
    if (!mes) {
      resumen.archivosNoReconocidos.push(path.basename(rutaArchivo));
      continue;
    }

    const hoja = encontrarHojaDelMes(workbook, mes);
    if (!hoja) {
      resumen.hojasNoEncontradas.push({ archivo: path.basename(rutaArchivo), mes, motivo: 'No existe una pestaña para ese mes' });
      continue;
    }

    const filaEncabezados = encontrarFilaEncabezados(hoja);
    if (!filaEncabezados) {
      resumen.hojasNoEncontradas.push({ archivo: path.basename(rutaArchivo), mes, motivo: 'No se encontró la fila de encabezados (FECHA, FOLIO, CLIENTE...)' });
      continue;
    }

    const mapaColumnas = mapearColumnas(hoja, filaEncabezados);
    const columnasAEscribir = ENCABEZADOS_A_ESCRIBIR.filter((h) => mapaColumnas[h]);
    const filasNuevas = leerYFiltrarEmitidos(rutaArchivo, regimenCodigo);

    const primeraFilaDatos = filaEncabezados + 1;

    // 1) Fila de totales ("TOTA FACTURADO" con =SUM(...) sobre el bloque de datos), si la hay.
    //    El bloque de datos llega hasta donde termina ese rango de la suma.
    const totales = encontrarFilaTotales(hoja, primeraFilaDatos);
    let filaFin = primeraFilaDatos - 1;

    if (totales) {
      filaFin = totales.finRango;
    } else {
      // Sin fila de totales: el bloque termina donde dejen de haber datos (tolera hasta 5 filas
      // vacías seguidas antes de asumir que ya no hay más).
      let vaciasSeguidas = 0;
      const limiteBusqueda = Math.max(hoja.rowCount || 0, primeraFilaDatos);
      for (let f = primeraFilaDatos; f <= limiteBusqueda; f++) {
        const tieneAlgo = columnasAEscribir.some((h) => {
          const v = hoja.getRow(f).getCell(mapaColumnas[h]).value;
          return v !== null && v !== undefined && String(v).trim() !== '';
        });
        if (tieneAlgo) {
          filaFin = f;
          vaciasSeguidas = 0;
        } else {
          vaciasSeguidas++;
          if (vaciasSeguidas >= 5) break;
        }
      }
    }

    // 2) Limpiar el bloque. Las celdas con FÓRMULA (p. ej. TOTAL = SUM(E:G)) no se tocan.
    for (let f = primeraFilaDatos; f <= filaFin; f++) {
      columnasAEscribir.forEach((h) => {
        const celda = hoja.getRow(f).getCell(mapaColumnas[h]);
        if (!esFormula(celda.value)) celda.value = null;
      });
    }

    // 3) Si hay más filas que espacio antes de la fila de totales, se insertan filas nuevas
    //    (copiando formato y fórmulas de la última fila) y se extiende el rango de las sumas.
    let filasInsertadas = 0;
    if (totales && filasNuevas.length > filaFin - primeraFilaDatos + 1) {
      filasInsertadas = filasNuevas.length - (filaFin - primeraFilaDatos + 1);
      insertarFilasAntesDeTotales(hoja, primeraFilaDatos, filaFin, filasInsertadas, totales.fila);
      filaFin += filasInsertadas;
    }

    // 4) Escribir las filas nuevas (sin pisar celdas con fórmula)
    filasNuevas.forEach((filaDatos, i) => {
      const numeroFila = primeraFilaDatos + i;
      columnasAEscribir.forEach((h) => {
        const celda = hoja.getRow(numeroFila).getCell(mapaColumnas[h]);
        if (esFormula(celda.value)) return;
        celda.value = filaDatos[h] !== undefined && filaDatos[h] !== '' ? filaDatos[h] : null;
      });
      hoja.getRow(numeroFila).commit();
    });

    resumen.hojasActualizadas.push({
      mes,
      hoja: hoja.name,
      archivo: path.basename(rutaArchivo),
      filas: filasNuevas.length,
      filasInsertadas,
      regimenFiltrado: regimenCodigo,
      conFilaDeTotales: !!totales,
    });
  }

  return { workbook, resumen };
}

module.exports = { rellenarExcelIngresos, detectarMes, MESES };
