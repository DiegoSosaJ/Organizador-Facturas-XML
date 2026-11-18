'use strict';

const fs = require('fs');
const path = require('path');
const xmlService = require('./xmlService');

const CARPETAS_SISTEMA = ['Ingresos', 'Egresos', 'Pagos'];

const FORMAS_PAGO = {
  '01': 'EFECTIVO',
  '02': 'CHEQUE',
  '03': 'TRANSF',
  '04': 'TARJETA CREDITO',
  '28': 'TARJETA DEBITO',
};

// -----------------------------------------------------------------------
// Indexado de CFDIs físicos (recorre toda la carpeta, incluidas subcarpetas,
// pero ignora las carpetas que el propio sistema ya generó)
// -----------------------------------------------------------------------
function indexarCfdis(carpeta) {
  const indice = new Map(); // uuid en minúsculas -> ruta absoluta del archivo

  function recorrer(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const rutaCompleta = path.join(dir, item.name);

      if (item.isDirectory()) {
        if (CARPETAS_SISTEMA.includes(item.name)) continue;
        recorrer(rutaCompleta);
      } else if (/\.xml$/i.test(item.name)) {
        // UUID real: también reconoce archivos ya renombrados (PAGADO ... ( uuid ), PAGO ... (uuid, etc.)
        const nombreSinExt = extraerUuidReal(path.basename(item.name, path.extname(item.name))).toLowerCase();
        indice.set(nombreSinExt, rutaCompleta);
      }
    }
  }

  recorrer(carpeta);
  return indice;
}

// -----------------------------------------------------------------------
// Utilidades de formato
// -----------------------------------------------------------------------
function formatearFecha(fechaISO) {
  if (!fechaISO) return 'SIN-FECHA';
  const soloFecha = String(fechaISO).split('T')[0];
  const partes = soloFecha.split('-');
  if (partes.length !== 3) return 'SIN-FECHA';
  const [anio, mes, dia] = partes;
  return `${dia} ${mes} ${anio}`;
}

function formatearMonto(monto) {
  if (monto === undefined || monto === null || monto === '') return '0';
  const numero = Number(monto);
  if (Number.isNaN(numero)) return String(monto);
  return Number.isInteger(numero) ? String(numero) : String(parseFloat(numero.toFixed(2)));
}

function nombreFormaPago(codigo) {
  if (!codigo) return 'SIN-FORMA-PAGO';
  return FORMAS_PAGO[String(codigo).trim()] || `FORMA-${codigo}`;
}

// Nombre de la subcarpeta donde se guardan el pago y su complemento.
// "Pago [Fecha complemento] Y CP [Fecha pago] Compras [ImpPagado] [FormaDePagoP]" en MAYÚSCULAS.
// Si un pago tiene más de un complemento (caso raro), se usa el primero para el nombre.
function construirNombreCarpetaPago(datosPago, datosComplemento) {
  const fechaComplemento = formatearFecha(datosComplemento.Fecha);
  const fechaPago = formatearFecha(datosPago.Fecha);
  const monto = formatearMonto(datosPago.ImpPagado);
  const formaPago = nombreFormaPago(datosPago.FormaDePagoP);
  return `Pago ${fechaComplemento} Y CP ${fechaPago} Compras ${monto} ${formaPago}`.toUpperCase();
}

// Nombre de archivo para los CFDIs que van a la carpeta Egresos.
// "PAGADO [Fecha] COMPRAS [Total] [FormaPago] ( uuid-original )" — todo en MAYÚSCULAS
// excepto el UUID original, que se deja tal cual estaba (para poder reconocerlo después).
function construirNombreEgreso(datos, uuidOriginal) {
  const fecha = formatearFecha(datos.Fecha);
  const monto = formatearMonto(datos.Total);
  const formaPago = nombreFormaPago(datos.FormaPago);
  const base = `Pagado ${fecha} Compras ${monto} ${formaPago}`.toUpperCase();
  return `${base} ( ${uuidOriginal} )`;
}

function sanitizarNombre(nombre) {
  return String(nombre).replace(/[\\/:*?"<>|]/g, '-').trim();
}

// Si el destino ya existe (choque de nombres), agrega un sufijo numérico al ARCHIVO.
function obtenerRutaArchivoSinColision(rutaDestino) {
  if (!fs.existsSync(rutaDestino)) return rutaDestino;
  const dir = path.dirname(rutaDestino);
  const ext = path.extname(rutaDestino);
  const base = path.basename(rutaDestino, ext);
  let contador = 2;
  let nuevaRuta;
  do {
    nuevaRuta = path.join(dir, `${base} (${contador})${ext}`);
    contador++;
  } while (fs.existsSync(nuevaRuta));
  return nuevaRuta;
}

// Cada PAGO (con su(s) complemento(s)) debe tener su PROPIA carpeta, aunque el nombre
// generado (fecha + monto + forma de pago) coincida con el de otro pago distinto.
// Por eso, a diferencia de los archivos, aquí SIEMPRE se crea una carpeta nueva:
// si el nombre ya existe, se agrega un sufijo numérico a la CARPETA (no se reutiliza).
function obtenerRutaCarpetaNueva(rutaCarpeta) {
  if (!fs.existsSync(rutaCarpeta)) return rutaCarpeta;
  const dir = path.dirname(rutaCarpeta);
  const base = path.basename(rutaCarpeta);
  let contador = 2;
  let nuevaRuta;
  do {
    nuevaRuta = path.join(dir, `${base} (${contador})`);
    contador++;
  } while (fs.existsSync(nuevaRuta));
  return nuevaRuta;
}

function moverArchivo(origen, destino) {
  const destinoFinal = obtenerRutaArchivoSinColision(destino);
  try {
    fs.renameSync(origen, destinoFinal);
  } catch (err) {
    // EXDEV: origen y destino están en discos/particiones distintos; rename() no puede
    // hacerlo de forma atómica, así que se copia y se borra el original.
    if (err.code === 'EXDEV') {
      fs.copyFileSync(origen, destinoFinal);
      fs.unlinkSync(origen);
    } else {
      throw err;
    }
  }
  return destinoFinal;
}

// A partir del nombre de archivo (sin extensión) obtiene el UUID "real" del CFDI,
// sin importar si el archivo ya fue renombrado por el sistema:
//   "NoEncontradoPago 26D8BB10-..."              -> "26D8BB10-..."
//   "PAGADO 31 01 2024 COMPRAS 50000 TRANSF ( 29ae0b52-... )" -> "29ae0b52-..."
//   "PAGO 02 02 2024 COMPRAS 928 TRANSF (0A..."   -> "0A..."
//   "FDC 26 01 2024 COMPRAS 928 (B1AD1D71..."     -> "B1AD1D71..."
//   "26D8BB10-..."                                -> "26D8BB10-..." (nombre normal, sin tocar)
function extraerUuidReal(nombreSinExt) {
  let m = /^NoEncontradoPago\s+(.+)$/i.exec(nombreSinExt);
  if (m) return m[1].trim();

  // Egresos ya renombrados: "PAGADO ... ( UUID )" (paréntesis cerrado, con espacios)
  m = /^PAGADO\s+.*\(\s*([^()]+?)\s*\)\s*$/i.exec(nombreSinExt);
  if (m) return m[1].trim();

  // Pagos/complementos ya renombrados: "PAGO ... (UUID" o "FDC ... (UUID" (paréntesis SIN cerrar)
  m = /^(?:PAGO|FDC)\s+.*\(([^()]+)$/i.exec(nombreSinExt);
  if (m) return m[1].trim();

  return nombreSinExt.trim();
}

// La columna "Tipo" del Excel puede venir como "P", "P - Pago", "P-Pago", etc.
// (el catálogo del SAT es de una sola letra, pero el exportador a veces agrega la
// descripción). Se considera "pago" si el texto empieza con "P" seguida de espacio,
// guion o fin de cadena (así no confunde con otros valores que empiecen distinto).
function esTipoPago(valorTipo) {
  const texto = String(valorTipo || '').trim();
  return /^P(\s|-|$)/i.test(texto);
}

// =========================================================================
// PAGOS  (debe ejecutarse ANTES que Egresos)
// =========================================================================
function planificarPagos(carpeta, filasRecibidos) {
  const indice = indexarCfdis(carpeta);
  const filasPago = filasRecibidos.filter((f) => esTipoPago(f['Tipo']));

  const plan = {
    total: filasPago.length,
    conComplemento: [],
    sinComplemento: [],
    noEncontradosEnCarpeta: [],
  };

  for (const fila of filasPago) {
    const uuid = String(fila['UUID'] || '').trim().toLowerCase();
    const rutaPago = indice.get(uuid);

    if (!rutaPago) {
      plan.noEncontradosEnCarpeta.push({ uuid: fila['UUID'] });
      continue;
    }

    const datosPago = xmlService.obtenerDatosCfdi(rutaPago);
    const idsDocumento = datosPago.IdDocumento || [];

    const complementos = [];
    for (const idDoc of idsDocumento) {
      const rutaComplemento = indice.get(String(idDoc).trim().toLowerCase());
      if (rutaComplemento) {
        complementos.push({
          ruta: rutaComplemento,
          datos: xmlService.obtenerDatosCfdi(rutaComplemento),
          idDocumento: idDoc,
        });
      }
    }

    if (complementos.length > 0) {
      const nombreCarpeta = construirNombreCarpetaPago(datosPago, complementos[0].datos);
      plan.conComplemento.push({ uuid: fila['UUID'], rutaPago, datosPago, nombreCarpeta, complementos });
    } else {
      plan.sinComplemento.push({ uuid: fila['UUID'], rutaPago, datosPago });
    }
  }

  return plan;
}

function ejecutarPagos(carpeta, plan) {
  const carpetaPagos = path.join(carpeta, 'Pagos');
  fs.mkdirSync(carpetaPagos, { recursive: true });

  const resumen = {
    carpetasDePagoCreadas: 0,
    archivosMovidosConComplemento: 0,
    archivosMovidosSinComplemento: 0,
    errores: [],
  };

  for (const item of plan.conComplemento) {
    try {
      const carpetaBase = path.join(carpetaPagos, sanitizarNombre(item.nombreCarpeta));
      const carpetaDestino = obtenerRutaCarpetaNueva(carpetaBase);
      fs.mkdirSync(carpetaDestino, { recursive: true });
      resumen.carpetasDePagoCreadas++;

      const fecha = formatearFecha(item.datosPago.Fecha);
      const monto = formatearMonto(item.datosPago.ImpPagado);
      const formaPago = nombreFormaPago(item.datosPago.FormaDePagoP);
      const extPago = path.extname(item.rutaPago);
      const nombreOriginalPago = extraerUuidReal(path.basename(item.rutaPago, extPago));
      const nuevoNombrePago = sanitizarNombre(`PAGO ${fecha} COMPRAS ${monto} ${formaPago} (${nombreOriginalPago}${extPago}`);

      moverArchivo(item.rutaPago, path.join(carpetaDestino, nuevoNombrePago));
      resumen.archivosMovidosConComplemento++;

      for (const comp of item.complementos) {
        const fechaComp = formatearFecha(comp.datos.Fecha);
        const totalComp = formatearMonto(comp.datos.Total);
        const extComp = path.extname(comp.ruta);
        const nombreOriginalComp = extraerUuidReal(path.basename(comp.ruta, extComp));
        const nuevoNombreComp = sanitizarNombre(`FDC ${fechaComp} COMPRAS ${totalComp} (${nombreOriginalComp}${extComp}`);

        moverArchivo(comp.ruta, path.join(carpetaDestino, nuevoNombreComp));
        resumen.archivosMovidosConComplemento++;
      }
    } catch (err) {
      resumen.errores.push({ uuid: item.uuid, error: err.message });
    }
  }

  for (const item of plan.sinComplemento) {
    try {
      const ext = path.extname(item.rutaPago);
      const nombreOriginal = extraerUuidReal(path.basename(item.rutaPago, ext));
      const nuevoNombre = sanitizarNombre(`NoEncontradoPago ${nombreOriginal}${ext}`);

      moverArchivo(item.rutaPago, path.join(carpetaPagos, nuevoNombre));
      resumen.archivosMovidosSinComplemento++;
    } catch (err) {
      resumen.errores.push({ uuid: item.uuid, error: err.message });
    }
  }

  return resumen;
}

// =========================================================================
// EGRESOS  (debe ejecutarse DESPUÉS que Pagos)
// =========================================================================
// Nombre de la subcarpeta (dentro de Egresos) para los CFDIs cuyo régimen receptor es distinto
// al del cliente: "Otro regimen (512 - Transporte)". Cada régimen distinto tiene su carpeta.
function construirNombreCarpetaOtroRegimen(codigo, catalogo) {
  const nombre = catalogo && catalogo[codigo];
  return sanitizarNombre(`Otro regimen (${codigo}${nombre ? ' - ' + nombre : ''})`);
}

/**
 * cliente: { nombre, regimenCodigo }  — régimen fiscal con el que trabaja el cliente.
 * catalogo: { '612': 'Personas Físicas...' } — solo para rotular las carpetas "Otro regimen".
 *
 * Cada egreso encontrado se clasifica leyendo Receptor@RegimenFiscalReceptor del XML:
 *   - igual al del cliente           -> categoria 'cliente'   (Egresos/)
 *   - distinto                       -> categoria 'otro'      (Egresos/Otro regimen (...)/)
 *   - el XML no lo trae (CFDI 3.3)   -> categoria 'sinRegimen' (Egresos/, no se puede validar)
 */
function planificarEgresos(carpeta, filasRecibidos, cliente, catalogo) {
  const indice = indexarCfdis(carpeta);
  const filas = filasRecibidos.filter((f) => !esTipoPago(f['Tipo']));
  const regimenCliente = String(cliente.regimenCodigo).trim();

  const plan = {
    total: filas.length,
    cliente: { nombre: cliente.nombre, regimenCodigo: regimenCliente },
    encontrados: [],
    noEncontrados: [],
  };

  for (const fila of filas) {
    const uuid = String(fila['UUID'] || '').trim().toLowerCase();
    const ruta = indice.get(uuid);
    if (!ruta) {
      plan.noEncontrados.push({ uuid: fila['UUID'] });
      continue;
    }

    let regimenXml = '';
    try {
      regimenXml = String(xmlService.obtenerDatosCfdi(ruta).RegimenFiscalReceptor || '').trim();
    } catch (err) {
      // XML ilegible: se trata como "sin régimen"; ejecutarEgresos reportará el error real.
    }

    const item = { uuid: fila['UUID'], ruta, regimenXml };
    if (!regimenXml) {
      item.categoria = 'sinRegimen';
    } else if (regimenXml === regimenCliente) {
      item.categoria = 'cliente';
    } else {
      item.categoria = 'otro';
      item.carpetaOtroRegimen = construirNombreCarpetaOtroRegimen(regimenXml, catalogo);
    }
    plan.encontrados.push(item);
  }

  return plan;
}

function ejecutarEgresos(carpeta, plan) {
  const carpetaEgresos = path.join(carpeta, 'Egresos');
  fs.mkdirSync(carpetaEgresos, { recursive: true });

  const resumen = { archivosMovidos: 0, archivosOtroRegimen: 0, errores: [] };

  for (const item of plan.encontrados) {
    try {
      const datos = xmlService.obtenerDatosCfdi(item.ruta);
      const ext = path.extname(item.ruta);
      const uuidOriginal = extraerUuidReal(path.basename(item.ruta, ext));
      // El nombre del archivo es el mismo para todos los egresos; solo cambia la carpeta destino.
      const nuevoNombre = sanitizarNombre(`${construirNombreEgreso(datos, uuidOriginal)}${ext}`);

      let carpetaDestino = carpetaEgresos;
      if (item.categoria === 'otro') {
        carpetaDestino = path.join(carpetaEgresos, item.carpetaOtroRegimen);
        fs.mkdirSync(carpetaDestino, { recursive: true });
      }

      moverArchivo(item.ruta, path.join(carpetaDestino, nuevoNombre));
      resumen.archivosMovidos++;
      if (item.categoria === 'otro') resumen.archivosOtroRegimen++;
    } catch (err) {
      resumen.errores.push({ uuid: item.uuid, error: err.message });
    }
  }

  return resumen;
}

// =========================================================================
// INGRESOS  (independiente, usa el Excel Emitidos)
// =========================================================================
function planificarIngresos(carpeta, filasEmitidos) {
  const indice = indexarCfdis(carpeta);
  const plan = { total: filasEmitidos.length, normales: [], cancelados: [], noEncontrados: [] };

  for (const fila of filasEmitidos) {
    const uuid = String(fila['UUID'] || '').trim().toLowerCase();
    const ruta = indice.get(uuid);

    if (!ruta) {
      plan.noEncontrados.push({ uuid: fila['UUID'] });
      continue;
    }

    const esCancelado = String(fila['Estado']).trim().toUpperCase().indexOf('CANCELADO') !== -1;
    (esCancelado ? plan.cancelados : plan.normales).push({ uuid: fila['UUID'], ruta });
  }

  return plan;
}

function ejecutarIngresos(carpeta, plan) {
  const carpetaIngresos = path.join(carpeta, 'Ingresos');
  const carpetaCancelados = path.join(carpetaIngresos, 'Cancelados');
  fs.mkdirSync(carpetaIngresos, { recursive: true });
  fs.mkdirSync(carpetaCancelados, { recursive: true });

  const resumen = { archivosMovidosNormales: 0, archivosMovidosCancelados: 0, errores: [] };

  for (const item of plan.normales) {
    try {
      moverArchivo(item.ruta, path.join(carpetaIngresos, path.basename(item.ruta)));
      resumen.archivosMovidosNormales++;
    } catch (err) {
      resumen.errores.push({ uuid: item.uuid, error: err.message });
    }
  }

  for (const item of plan.cancelados) {
    try {
      moverArchivo(item.ruta, path.join(carpetaCancelados, path.basename(item.ruta)));
      resumen.archivosMovidosCancelados++;
    } catch (err) {
      resumen.errores.push({ uuid: item.uuid, error: err.message });
    }
  }

  return resumen;
}

// =========================================================================
// BÚSQUEDA DE PAGOS ENTRE MÚLTIPLES CARPETAS (distintos meses)
// =========================================================================

// Indexa TODOS los .xml de varias carpetas raíz (recursivo, SIN excluir las
// carpetas Ingresos/Egresos/Pagos, ya que el complemento que buscamos puede
// estar ya organizado dentro de cualquiera de ellas en otro mes).
// La llave del índice es el UUID "real" (ver extraerUuidReal), así encuentra
// tanto archivos con su nombre original como archivos ya renombrados por el sistema.
function indexarCfdisMultiple(carpetas) {
  const indice = new Map(); // uuid real (minúsculas) -> { ruta, carpetaOrigen }

  function recorrer(dir, carpetaOrigen) {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return; // carpeta no accesible, se ignora
    }

    for (const item of items) {
      const rutaCompleta = path.join(dir, item.name);
      if (item.isDirectory()) {
        recorrer(rutaCompleta, carpetaOrigen);
      } else if (/\.xml$/i.test(item.name)) {
        const nombreSinExt = path.basename(item.name, path.extname(item.name));
        const uuidReal = extraerUuidReal(nombreSinExt).toLowerCase();
        if (!indice.has(uuidReal)) {
          indice.set(uuidReal, { ruta: rutaCompleta, carpetaOrigen });
        }
      }
    }
  }

  carpetas.forEach((carpeta) => recorrer(carpeta, carpeta));
  return indice;
}

// Dentro de la carpeta de un mes, regresa los archivos que quedaron
// pendientes (prefijo "NoEncontradoPago "), directamente dentro de /Pagos.
function listarPagosPendientes(carpeta) {
  const carpetaPagos = path.join(carpeta, 'Pagos');
  if (!fs.existsSync(carpetaPagos)) return [];

  return fs
    .readdirSync(carpetaPagos, { withFileTypes: true })
    .filter((it) => it.isFile() && /\.xml$/i.test(it.name) && /^NoEncontradoPago\s+/i.test(it.name))
    .map((it) => path.join(carpetaPagos, it.name));
}

/**
 * Analiza varias carpetas (meses) en el orden en que se seleccionaron.
 * Para cada una, busca sus pagos pendientes (NoEncontradoPago) y trata de
 * localizar su(s) complemento(s) en el conjunto de TODAS las carpetas dadas.
 */
function planificarPagosMultiplesCarpetas(carpetas) {
  const indiceGlobal = indexarCfdisMultiple(carpetas);
  const resultadoPorCarpeta = [];

  for (const carpeta of carpetas) {
    const pendientes = listarPagosPendientes(carpeta);
    const encontrados = [];
    const siguenSinEncontrarse = [];

    for (const rutaPago of pendientes) {
      const datosPago = xmlService.obtenerDatosCfdi(rutaPago);
      const idsDocumento = datosPago.IdDocumento || [];

      const complementos = [];
      for (const idDoc of idsDocumento) {
        const entrada = indiceGlobal.get(String(idDoc).trim().toLowerCase());
        // Evita auto-referencia (el propio archivo de pago) por seguridad
        if (entrada && path.resolve(entrada.ruta) !== path.resolve(rutaPago)) {
          complementos.push({
            ruta: entrada.ruta,
            carpetaOrigen: entrada.carpetaOrigen,
            datos: xmlService.obtenerDatosCfdi(entrada.ruta),
            idDocumento: idDoc,
          });
        }
      }

      const uuidReal = extraerUuidReal(path.basename(rutaPago, path.extname(rutaPago)));

      if (complementos.length > 0) {
        const nombreCarpeta = construirNombreCarpetaPago(datosPago, complementos[0].datos);
        encontrados.push({ uuid: uuidReal, rutaPago, datosPago, nombreCarpeta, complementos });
      } else {
        siguenSinEncontrarse.push({ uuid: uuidReal, rutaPago, idsBuscados: idsDocumento });
      }
    }

    resultadoPorCarpeta.push({
      carpeta,
      totalPendientes: pendientes.length,
      encontrados,
      siguenSinEncontrarse,
    });
  }

  return resultadoPorCarpeta;
}

/**
 * Ejecuta el plan generado por planificarPagosMultiplesCarpetas.
 *
 * IMPORTANTE: a diferencia del proceso de una sola carpeta, aquí es el PAGO el que se
 * mueve a donde está su complemento (no al revés). La subcarpeta se crea dentro de la
 * carpeta "Pagos" de la carpeta raíz (mes) donde vive el complemento —no como hermana
 * directa del archivo complemento, sin importar en qué subcarpeta (Ingresos, Egresos,
 * Pagos u otra) esté guardado actualmente—, y ahí se mueven tanto el pago como su(s)
 * complemento(s), renombrados con la misma convención de siempre. Si un pago tiene más
 * de un complemento en carpetas raíz distintas (caso raro), se usa la ubicación del
 * primero encontrado.
 */
function ejecutarPagosMultiplesCarpetas(planPorCarpeta) {
  const resumen = { totalResueltos: 0, totalConError: 0, porCarpeta: [] };

  for (const grupo of planPorCarpeta) {
    const resumenCarpeta = { carpeta: grupo.carpeta, resueltos: 0, errores: [] };

    for (const item of grupo.encontrados) {
      try {
        const primerComplemento = item.complementos[0];
        const carpetaPagosDestino = path.join(primerComplemento.carpetaOrigen, 'Pagos');
        fs.mkdirSync(carpetaPagosDestino, { recursive: true }); // por si no existiera aún

        const carpetaBase = path.join(carpetaPagosDestino, sanitizarNombre(item.nombreCarpeta));
        const carpetaDestino = obtenerRutaCarpetaNueva(carpetaBase);
        fs.mkdirSync(carpetaDestino, { recursive: true });

        const fecha = formatearFecha(item.datosPago.Fecha);
        const monto = formatearMonto(item.datosPago.ImpPagado);
        const formaPago = nombreFormaPago(item.datosPago.FormaDePagoP);
        const extPago = path.extname(item.rutaPago);
        const nombreOriginalPago = extraerUuidReal(path.basename(item.rutaPago, extPago));
        const nuevoNombrePago = sanitizarNombre(`PAGO ${fecha} COMPRAS ${monto} ${formaPago} (${nombreOriginalPago}${extPago}`);

        moverArchivo(item.rutaPago, path.join(carpetaDestino, nuevoNombrePago));
        resumenCarpeta.resueltos++;
        resumen.totalResueltos++;

        for (const comp of item.complementos) {
          const fechaComp = formatearFecha(comp.datos.Fecha);
          const totalComp = formatearMonto(comp.datos.Total);
          const extComp = path.extname(comp.ruta);
          const nombreOriginalComp = extraerUuidReal(path.basename(comp.ruta, extComp));
          const nuevoNombreComp = sanitizarNombre(`FDC ${fechaComp} COMPRAS ${totalComp} (${nombreOriginalComp}${extComp}`);

          moverArchivo(comp.ruta, path.join(carpetaDestino, nuevoNombreComp));
        }
      } catch (err) {
        resumenCarpeta.errores.push({ uuid: item.uuid, error: err.message });
        resumen.totalConError++;
      }
    }

    resumen.porCarpeta.push(resumenCarpeta);
  }

  return resumen;
}

module.exports = {
  indexarCfdis,
  planificarPagos,
  ejecutarPagos,
  planificarEgresos,
  ejecutarEgresos,
  planificarIngresos,
  ejecutarIngresos,
  planificarPagosMultiplesCarpetas,
  ejecutarPagosMultiplesCarpetas,
};
