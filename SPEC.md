# PROMPT: Organizador de CFDIs + Llenador de Excel de Ingresos

Especificación funcional de referencia. Sobre este documento se irán modificando y ajustando los cambios de la app.

Eres un desarrollador senior. Construye una app de escritorio con Electron + Express (Node) + AngularJS 1.x (factorys con $resource, un controlador principal, HTML con ng-*). Sin base de datos y sin modelos Sequelize: todo es lectura de Excel + lectura/movimiento de archivos en disco. Cambios de diseño no deben alterar la lógica descrita aquí.

Idioma de la UI y de los nombres de archivos: español.

## 1. Arquitectura

- `main.js` (Electron): levanta Express interno en `localhost:4123`, abre la ventana, expone diálogos nativos por IPC (`preload.js` + `contextBridge`, `contextIsolation: true`, `nodeIntegration: false`):
  - seleccionar una carpeta, seleccionar varias carpetas (`openDirectory` + `multiSelections`)
  - seleccionar varios Excel, seleccionar un Excel, guardar Excel (`showSaveDialog`)
- Express: rutas `/api/cfdi/*` y `/api/ingresos-excel/*`. Respuesta siempre `{ meta: { success, message }, data }`.
- Servicios: `excelService` (leer Excel plano), `xmlService` (leer atributos de CFDI), `organizerService` (lógica de carpetas), `ingresosExcelService` (llenar Excel maestro).
- Angular y angular-resource se sirven desde `node_modules` (la app debe funcionar sin internet).
- Estado en memoria del proceso (planes y filas de Excel por carpeta). Nada se persiste.
- Empaquetado: electron-builder (NSIS x64) → .exe instalable. Librerías: `xlsx` (leer Excel plano), `exceljs` (editar Excel maestro conservando formato), `fast-xml-parser` (XML).

## 2. Regla general de movimiento de archivos

- Los archivos se **mueven** (nunca se copian).
- Si `rename` falla con `EXDEV` (otro disco), copiar + borrar original.
- Si el nombre destino de un archivo ya existe → agregar sufijo ` (2)`, ` (3)`… antes de la extensión.
- Si el nombre destino de una carpeta de pago ya existe → crear siempre una carpeta nueva con sufijo ` (2)`, ` (3)`… (nunca reutilizar, cada pago va con su propio complemento aunque el nombre coincida).
- Sanitizar nombres: reemplazar `\ / : * ? " < > |` por `-` y hacer trim.
- Todo proceso que mueve archivos sigue **vista previa → confirmar → resumen**. La vista previa no modifica nada y muestra cantidades (y detalle). Confirmar ejecuta. El resumen muestra qué se hizo y errores.
- Las cantidades de la vista previa son informativas: no hay validación bloqueante entre filas del Excel y archivos existentes. Si un UUID del Excel no existe como archivo, solo se reporta ("no encontrado en la carpeta") y no se mueve.

## 3. Entradas y detección de archivos

**Carpeta de trabajo** (una por mes). Se pueden seleccionar varias; se procesan de una en una (UI: "Carpeta X de N", botones anterior/siguiente; al cambiar de carpeta se reinicia el estado de esa pantalla y hay que volver a cargar los Excel). Las carpetas `Ingresos`, `Egresos` y `Pagos` se crean dentro de la carpeta seleccionada.

**Detección de Excel en la carpeta**: archivos `.xlsx`/`.xls` cuyo nombre contenga `emitid` → Emitidos, `recibid` → Recibidos (sin importar mayúsculas). Si falta alguno, error con la lista de .xlsx encontrados.

**Lectura de Excel**: primera hoja, fila 1 = encabezados, acceso siempre **por nombre de columna** (nunca por posición: el orden y las columnas extra varían entre meses, p. ej. UUIDs relacionados, Tipo relacion, Global periodicidad).

**Indexado de CFDIs**: recorrer la carpeta recursivamente (raíz y subcarpetas de mes). Clave = UUID real extraído del nombre del archivo (`extraerUuidReal`: acepta el nombre original `UUID.xml` y también archivos ya renombrados `PAGADO … ( uuid )`, `PAGO … (uuid`, `FDC … (uuid`, `NoEncontradoPago uuid`), en minúsculas, trim. En los procesos de una sola carpeta se excluyen las subcarpetas `Ingresos`, `Egresos` y `Pagos` del recorrido (ya son resultado del sistema).

## 4. Relación columnas de Excel ↔ XML del CFDI

### 4.1 Cómo se ligan un renglón y su XML

- La columna `UUID` del Excel = nombre del archivo XML (sin `.xml`), comparación sin distinguir mayúsculas/minúsculas.
- El mismo UUID aparece en el XML en `TimbreFiscalDigital@UUID` (el sistema no usa ese atributo para ligar, solo el nombre de archivo).
- `IdDocumento` (dentro del XML del pago) = UUID de otro CFDI = nombre del archivo del complemento/documento relacionado.

### 4.2 Lectura de XML

- Parsear con `removeNSPrefix` (ignorar prefijos `cfdi:`, `pago20:`, `tfd:`…) y atributos sin prefijo.
- Buscar atributos por nombre, recursivamente, en cualquier nodo; para atributos simples tomar la primera ocurrencia (en orden de documento, el nodo raíz Comprobante va primero); para `IdDocumento` tomar **todas** las ocurrencias (un pago puede relacionar varios documentos).

### 4.3 Atributos que el sistema LEE del XML

| Atributo XML | Nodo típico | Uso |
|---|---|---|
| Fecha | Comprobante | fecha en nombres (formato DD MM YYYY, se toma la parte antes de T) |
| Total | Comprobante | monto en nombre de Egreso y de FDC (complemento) |
| FormaPago | Comprobante | forma de pago en nombre de Egreso (código 01, 03…) |
| FormaDePagoP | Pagos/Pago | forma de pago en nombre de Pago |
| ImpPagado | Pagos/Pago/DoctoRelacionado | monto en nombre de Pago y de la subcarpeta |
| IdDocumento | DoctoRelacionado | UUID del complemento a buscar |
| ImporteP, UUID | varios | se leen pero no determinan nombres |

### 4.4 Columnas de Excel que el sistema usa para ORGANIZAR

| Excel | Columna | Valores reales | Regla |
|---|---|---|---|
| Recibidos | UUID | 07f63fa1-b625-… | nombre del XML a buscar |
| Recibidos | Tipo | I - Ingreso, P - Pago, P | es pago si coincide `/^P(\s\|-\|$)/i` (acepta P, P - Pago, P-Pago; NO PUE, NO Pago diferido) |
| Emitidos | UUID | idem | nombre del XML a buscar |
| Emitidos | Estado | VIGENTE, CANCELADO | si contiene CANCELADO (sin importar mayúsculas) → Ingresos/Cancelados |

### 4.5 Equivalencias Excel ↔ XML (para validar datos; el sistema solo lee los marcados en 4.3)

| Columna Excel (Recibidos/Emitidos) | Ejemplo Excel | Atributo XML equivalente |
|---|---|---|
| UUID | 07f63fa1-b625-4c9d-… | TimbreFiscalDigital@UUID y nombre de archivo |
| Version | 4.0 | Comprobante@Version |
| Serie, Folio (solo Recibidos) | A, MAT_44284_00001 | Comprobante@Serie, @Folio |
| Tipo | P - Pago | Comprobante@TipoDeComprobante (P) |
| Fecha emision | 2025-03-31 18:07:25 (texto) | Comprobante@Fecha (2025-03-31T18:07:25) |
| Fecha certificacion | | TimbreFiscalDigital@FechaTimbrado |
| pacCertifico | | TimbreFiscalDigital@RfcProvCertif |
| CP Expedicion | 97109 | Comprobante@LugarExpedicion |
| RFC emisor / Razon emisor / Regimen emisor | AAA010101AAA / … / 601 o 612 - … | Emisor@Rfc / @Nombre / @RegimenFiscal |
| RFC receptor / Razon receptor / Regimen receptor | XAXX010101000 / … / 612 | Receptor@Rfc / @Nombre / @RegimenFiscalReceptor |
| Domicilio receptor | 97345 | Receptor@DomicilioFiscalReceptor |
| Uso CFDI | CP01, G03 | Receptor@UsoCFDI |
| Claves de productos / Conceptos | | Concepto@ClaveProdServ / @Descripcion |
| Moneda, Tipo de cambio, Exportacion | MXN, 01 No aplica | Comprobante@Moneda, @TipoCambio, @Exportacion |
| Metodo pago | PUE | Comprobante@MetodoPago |
| Forma pago | 03 - Transferencia electrónica de fondos | Comprobante@FormaPago (03) |
| SubTotal | 52545.68 | Comprobante@SubTotal |
| Descuento | | Comprobante@Descuento |
| IVA Trasladado 16% (o IVA Trasladado) | 8407.31 | Traslado@Importe con Impuesto=002, TasaOCuota=0.160000 |
| Total | 60952.99 | Comprobante@Total |
| Estado | VIGENTE / CANCELADO | no está en el XML (viene del SAT) |
| Complementos | CP01 - Pagos | nodo Complemento (pago20:Pagos) |

Ejemplo de pago real: `Tipo = P - Pago`, `Total = 4862.7`; XML con `Pagos/Pago@FormaDePagoP="03"`, `DoctoRelacionado@IdDocumento="05f79903-a618-485e-9894-c8f6ce201d17"`, `@ImpPagado="4862.70"`.

## 5. Formatos comunes

- **Fecha**: `DD MM YYYY` (ej. `2024-02-02T08:01:00` → `02 02 2024`). Si falta o es inválida → `SIN-FECHA`.
- **Monto**: entero sin decimales (`928.00` → `928`); con decimales, máximo 2 y sin ceros sobrantes (`411.20` → `411.2`). Vacío → `0`. No numérico → se deja tal cual.
- **Forma de pago (catálogo)**: `01` → EFECTIVO, `02` → CHEQUE, `03` → TRANSF, `04` → TARJETA CREDITO, `28` → TARJETA DEBITO. Otro código → `FORMA-<código>`. Vacío → `SIN-FORMA-PAGO`.
- Todo el texto de nombres en MAYÚSCULAS, excepto el UUID original, que conserva su capitalización.

## 6. Proceso: Organizar CFDIs (por carpeta)

Orden obligatorio: **Pagos → Egresos**. Ingresos es independiente. El botón Egresos está deshabilitado hasta confirmar Pagos (el complemento de un pago normalmente tiene su propio renglón Tipo != P en Recibidos; si Egresos corriera antes, lo movería/renombraría y Pagos ya no podría encontrarlo). Los tres botones están deshabilitados hasta cargar ambos Excel.

### 6.1 Buscar Pagos (Excel Recibidos, Tipo = P)

Para cada renglón pago:

1. Localizar su XML por UUID. Si no existe en la carpeta → "no encontrado", no se mueve.
2. Leer del XML: `Fecha`, `ImpPagado`, `FormaDePagoP` y todos los `IdDocumento`.
3. Buscar cada `IdDocumento` entre los XML de la carpeta (índice recursivo).
4. **Con complemento(s) encontrado(s)** → crear una subcarpeta nueva por pago dentro de `Pagos/` y mover ahí el pago y todos sus complementos:
   - Subcarpeta: `PAGO {Fecha del complemento} Y CP {Fecha del pago} COMPRAS {ImpPagado} {FORMA}` (mayúsculas; si hay varios complementos, la fecha del primero).
   - Archivo pago: `PAGO {Fecha pago} COMPRAS {ImpPagado} {FORMA} ({uuid}.xml`
   - Archivo complemento: `FDC {Fecha complemento} COMPRAS {Total del complemento} ({uuid}.xml`
   - El paréntesis se abre y **no se cierra** (separa el nombre original).
5. **Sin complemento** → mover el pago directo a `Pagos/` (sin subcarpeta) como `NoEncontradoPago {uuid}.xml`.

Ejemplo: pago 02/02/2024 ImpPagado 928.00, FormaDePagoP 03, complemento 26/01/2024 → `Pagos/PAGO 26 01 2024 Y CP 02 02 2024 COMPRAS 928 TRANSF/` con `PAGO 02 02 2024 COMPRAS 928 TRANSF (0A000098-….xml` y `FDC 26 01 2024 COMPRAS 928 (B1AD1D71-….xml`.

Vista previa: total de pagos, con complemento, sin complemento (NoEncontradoPago), no encontrados en la carpeta.

### 6.2 Buscar Egresos (Excel Recibidos, Tipo != P)

- Mover a `Egresos/` y renombrar: `PAGADO {Fecha} COMPRAS {Total} {FORMA} ( {uuid-original} ).xml`
- `{FORMA}` sale de `FormaPago` del XML (no de `FormaDePagoP`).
- Espacios alrededor de los paréntesis y paréntesis cerrado. Ej.: `PAGADO 31 01 2024 COMPRAS 50000 TRANSF ( 29ae0b52-f8fd-446f-8794-0142971c0155 ).xml`
- Se agrega el UUID para que la búsqueda entre meses siga encontrando el archivo por `IdDocumento`.
- Sin dato nuevo de nombre más allá de esto; si dos egresos generan el mismo nombre, aplica el sufijo ` (2)` de archivo.

**Cliente y régimen fiscal (obligatorio para Egresos).** Al inicio de la pestaña "Organizar CFDIs" hay una tarjeta para elegir o crear al cliente y su régimen fiscal (el régimen del cliente se puede cambiar en cualquier momento). Se guardan en `clientes.json` dentro de `app.getPath('userData')` (variable `CFDI_DATA_DIR`), junto con un catálogo de regímenes (precargado con el catálogo SAT; el usuario puede agregar los suyos, p. ej. `512 - Transporte`). **Implementación (importante):** el cliente seleccionado vive en `$scope.sel.clienteId` (objeto, no valor suelto): el `<select>` está dentro de un `ng-if`, y un valor suelto con `ng-model` se copiaría al ámbito hijo sin llegar al controlador (el régimen mostrado/usado quedaba en el cliente anterior). Sin cliente seleccionado, Egresos no se puede previsualizar (el backend lo rechaza). Pagos e Ingresos (organizar) no lo usan; "Llenar Excel de Ingresos" sí (filtro de Regimen emisor).

Clasificación de cada egreso encontrado, comparando `Receptor@RegimenFiscalReceptor` del XML (solo existe en CFDI 4.0) con el régimen del cliente:
- Igual → `Egresos/`.
- Distinto → `Egresos/Otro regimen ({número} - {nombre})/`, con **el mismo nombre de archivo** `PAGADO … ( uuid ).xml`. Un régimen distinto = una carpeta distinta. Estos archivos no deben considerarse para el llenado de los Excel.
- El XML no trae el atributo (CFDI 3.3) → no se puede validar: se queda en `Egresos/` y la vista previa lo avisa ("Sin régimen en el XML").
- El botón "Corregir nombre de CFDIs egreso" fue eliminado del programa (ya no se usa): los archivos de Egresos conservan el sufijo `( uuid )`.

### 6.3 Buscar Ingresos (Excel Emitidos)

- Todos los renglones: mover a `Ingresos/` conservando el nombre original.
- `Estado` contiene CANCELADO → `Ingresos/Cancelados/`.

## 7. Pestaña: Buscar pagos de diferentes meses

Resuelve los `NoEncontradoPago` cuyo complemento está en otro mes.

1. Seleccionar mínimo 2 carpetas (cada una ya organizada, con su `Pagos/`).
2. Construir un índice global de todos los XML de todas las carpetas, recursivo, **incluyendo** Ingresos, Egresos y Pagos. La clave es el UUID real extraído del nombre:
   - `NoEncontradoPago {uuid}` → uuid
   - `PAGADO … ( {uuid} )` → uuid (regex `/^PAGADO\s+.*\(\s*([^()]+?)\s*\)\s*$/i`)
   - `PAGO …(` / `FDC …(` + `{uuid}` (paréntesis sin cerrar) → uuid (regex `/^(?:PAGO|FDC)\s+.*\(([^()]+)$/i`)
   - cualquier otro nombre → el nombre completo.
3. Procesar carpeta por carpeta, en el orden seleccionado. Pendientes = archivos `NoEncontradoPago *.xml` directamente dentro de `<carpeta>/Pagos`.
4. Por cada pendiente: leer `IdDocumento`(s) del XML y buscarlos en el índice global (ignorar auto-coincidencia con el propio archivo).
5. **Dirección del movimiento**: el PAGO va a donde está su complemento (no al revés). La subcarpeta se crea en `<carpeta raíz donde vive el complemento>/Pagos/` (se crea `Pagos` si no existe), nunca como hermana directa del archivo ni en la raíz del mes. Nombre de subcarpeta y de archivos: idénticos a 6.1 (se quita el prefijo `NoEncontradoPago` y se renombra a `PAGO …`; el complemento a `FDC …`). Si hay varios complementos en carpetas distintas, manda la ubicación del primero (y el nombre de la subcarpeta se arma con el primero); todos se mueven a esa misma subcarpeta. La vista previa (de una carpeta y de varios meses) muestra el UUID del pago (de la columna UUID de Recibidos / del nombre del archivo) y el UUID de cada complemento (`IdDocumento` dentro del XML del pago), con su mes de origen, y advierte cuando un pago liquida más de un complemento.
6. Sin complemento en ninguna carpeta → sigue pendiente (se reporta).

Vista previa por carpeta: pagos pendientes, encontrados, que seguirán sin encontrarse; por cada encontrado: nombre del archivo de pago, nombre de la subcarpeta, ruta donde se creará, y nombre de cada complemento con la carpeta donde está actualmente. Luego confirmar y resumen por carpeta (resueltos / errores).

(El antiguo botón "Corregir nombre de CFDIs egreso" fue eliminado; no existe la ruta `/egresos/corregir-nombres`.)

## 8. Pestaña: Llenar Excel de Ingresos

Entradas: (1) uno o varios Excel de Emitidos (uno por mes), (2) el Excel maestro de 12 pestañas. (3) el **año** que se está haciendo (4 dígitos; por defecto el año actual). Botón **Rellenar** (deshabilitado hasta tener ambos archivos y un año válido) → diálogo de guardar → procesar → resumen.

**Nombre sugerido al guardar**: `INGRESOS {año} actualizado {dd-mm-yyyy}.xlsx` (ej. `INGRESOS 2026 actualizado 18-11-2026.xlsx`). Se usan guiones en la fecha porque Windows no permite `/` en nombres de archivo.

**Detección de mes (por nombre de archivo)**: el nombre, sin extensión, quitando acentos y en mayúsculas, debe **empezar** con ENERO…DICIEMBRE (acepta `ENERO`, `febrero`, `marzoVentas`, `Septiembre Emitidos`). Si no → "archivo sin mes reconocible".

**Año y nombre de pestañas**: con el año indicado, las 12 pestañas de mes se renombran a `{MES} {AÑO}` con el año completo tal cual lo escribió el usuario (2026 → `ENERO 2026`, `FEBRERO 2026`…), estén o no entre los meses que se llenan. El backend rechaza un año que no sean 4 dígitos. El resumen lista las pestañas renombradas. (No se ajustan fórmulas entre hojas: la plantilla no tiene referencias a otras pestañas.)

**Detección de hoja**: pestaña cuyo nombre normalizado empieza con el mes (reales: `ENERO 24`, `FEBRERO24`, `MARZO 24`…). Si no existe → "no se pudo actualizar".

**Filtro del Excel de Emitidos** (ambas condiciones):
1. `Estado` empieza con VIGENTE (cualquier capitalización).
2. `Regimen emisor` empieza con el código del **régimen del cliente seleccionado** (valor puede ser `612` o `612 - Personas Físicas…`). El régimen ya no es fijo: cada cliente tiene el suyo y puede cambiarlo (misma tarjeta "Cliente y régimen fiscal" que Organizar, visible en ambas pestañas). Sin cliente seleccionado el botón Rellenar está deshabilitado y el backend rechaza la petición (`clienteId`). Si ningún Emitido cumple, la pestaña queda con 0 filas y el resumen lo avisa con el régimen usado.

**Mapeo Emitidos → Maestro**:

| Maestro | Emitidos |
|---|---|
| FECHA | Fecha emision (texto tal cual, ej. 2024-02-12 23:11:53) |
| FOLIO | UUID |
| CLIENTE | Razon receptor |
| FORMA DE PAGO | Forma pago |
| RFC | RFC receptor |
| VENTAS 0% | base de la columna `IVA Trasladado 0%` (en Emitidos esa columna trae la base de ventas a tasa 0, no un impuesto); vacío si no existe |
| VENTAS 16% | SubTotal (si solo hay columna 0%: vacío; si hay ambas: SubTotal − base 0%) |
| IVA | IVA Trasladado 16% (0 si solo hay columna 0%) |
| TOTAL | Total |

**Columna IVA — búsqueda tolerante**: el encabezado varía entre meses (`IVA Trasladado 16%`, `IVA Trasladado`, `IVA Trasladado_16`…). Tomar las columnas cuyo nombre empieza con `IVA Trasladado` (sin acentos/mayúsculas). Si hay una → esa. Si hay varias → la que contenga `16` en el nombre (en cualquier posición y sin importar el orden); si ninguna lo contiene → la primera.

**Ubicación de la tabla en cada pestaña (no hardcodear filas)**:
- Revisar las primeras 15 filas y elegir la que tenga más coincidencias con `FECHA, FOLIO, CLIENTE, FORMA DE PAGO, RFC, VENTAS 0%, VENTAS 16%, IVA, TOTAL` (comparación sin acentos/mayúsculas). Mínimo 3 coincidencias; si no → error "no se encontró la fila de encabezados". En los archivos reales los encabezados están en la fila 5 (fila 3 tiene el título PLATAFORMAS, fila 4 vacía), pero puede variar.
- Mapear cada encabezado a su número de columna según lo encontrado.
- Los datos se escriben desde la fila inmediatamente siguiente a los encabezados.

**Fórmulas y totales de la plantilla**: la plantilla trae `TOTAL = SUM(VENTAS 0%:IVA)` por fila y una fila de totales (`TOTA FACTURADO`, `=SUM(X4:X18)`). Las celdas con fórmula **nunca se limpian ni se sobrescriben** (TOTAL queda como fórmula). La fila de totales se detecta por tener `=SUM` de una columna completa hacia arriba; el bloque de datos llega hasta el final de ese rango. Si hay más filas que espacio, se insertan filas antes de los totales (copiando formato y la fórmula por fila de la primera fila de datos) y se extiende el rango de cada `SUM`. Se fuerza recálculo al abrir en Excel (`fullCalcOnLoad`).

**Sobrescritura**: si la pestaña ya tenía datos, se detecta dónde termina el bloque actual (hasta 5 filas vacías consecutivas), se limpian solo las columnas de la tabla en ese bloque, y se escriben las filas nuevas. Nada fuera de esas columnas se toca.

**Reglas de seguridad**:
- El archivo original nunca se modifica: se trabaja sobre una copia en memoria y se guarda en la ruta que el usuario elige.
- Solo se actualizan las pestañas de los meses cargados; las demás quedan idénticas.
- Se conserva el formato de las celdas (solo se cambia el valor).
- Si dos archivos corresponden al mismo mes, se procesan en orden y el último sobrescribe.
- Los montos (VENTAS 16%, IVA, TOTAL) deben quedar como número, no como texto.
- Resumen: pestañas actualizadas (mes, hoja, filas, archivo origen), archivos sin mes reconocible, hojas/encabezados no encontrados.

## 9. Validaciones y manejo de errores

- Excel faltante o ilegible → mensaje claro y UI sin avanzar.
- Cualquier error por archivo se captura, se acumula en `errores` (`{uuid, error}`) y no detiene el lote; el resumen indica cuántos fallaron.
- Confirmar sin vista previa previa → rechazar ("genera primero la vista previa").
- Egresos antes de confirmar Pagos → rechazar en backend y deshabilitar en UI.
- Volver a cargar los Excel reinicia planes y confirmaciones de esa carpeta.
- Buscar entre meses con menos de 2 carpetas → rechazar.
- Comparaciones de UUID siempre en minúsculas y con trim.
- No leer atributos por posición ni asumir namespaces fijos.

## 10. Casos de prueba mínimos

1. `Tipo = "P - Pago"` (UUID 07f63fa1-b625-4c9d-ac66-dec837692e87) → se clasifica como pago y no cae en Egresos.
2. Dos pagos con misma fecha/monto/forma y complementos distintos → dos subcarpetas (`…` y `… (2)`), cada una con su par.
3. Pago cuyo complemento no está en el mes → `Pagos/NoEncontradoPago {uuid}.xml`; luego, al buscar entre meses y encontrarse en otra carpeta que ya lo tiene como `PAGADO … ( uuid ).xml`, la subcarpeta se crea en el `Pagos/` de esa carpeta con pago renombrado a `PAGO …` y complemento a `FDC …`.
4. Egreso 29ae0b52-f8fd-446f-8794-0142971c0155 (Fecha 2024-01-31, Total 50000.00, FormaPago 03) → `PAGADO 31 01 2024 COMPRAS 50000 TRANSF ( 29ae0b52-f8fd-446f-8794-0142971c0155 ).xml`; el sufijo `( uuid )` se conserva.
5. Llenar Ingresos con Febrero, Marzo y Abril: febrero (9 filas, 3 CANCELADO) → 6 filas; marzo (9, 1 cancelado) → 8; abril → 3; escritas desde la fila 6; Enero y demás pestañas intactas.
6. Fila VIGENTE con SubTotal 52545.68, IVA Trasladado 8407.31, Total 60952.99 → VENTAS 16% = 52545.68, IVA = 8407.31, TOTAL = 60952.99.
7. Excel de Emitidos con columna `IVA Trasladado` (sin 16%) y valor 10020.74 → IVA = 10020.74.
8. Con columnas `IVA Trasladado 8%` e `IVA Trasladado 16%` en cualquier orden → siempre la del 16.
