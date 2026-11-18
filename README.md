# Organizador de CFDIs

App de escritorio (Electron + Express + AngularJS) con tres funciones principales:
1. Organizar CFDIs (XML) en las carpetas **Ingresos**, **Egresos** y **Pagos**, con base en los
   Excel de **Emitidos** y **Recibidos**, incluyendo el cruce de complementos de pago (PPD).
2. Buscar, entre varias carpetas de distintos meses, el complemento de los pagos que quedaron
   pendientes (`NoEncontradoPago`).
3. **Llenar Excel de Ingresos**: tomar uno o varios Excel de "Emitidos" (uno por mes) y volcar sus
   datos (ya filtrados) en la pestaña correspondiente de un Excel maestro de 12 pestañas.

No usa base de datos: todo el trabajo es lectura de Excel + lectura/movimiento de archivos en disco.

## Requisitos
- Node.js **v23** (o compatible reciente)
- VS Code (o cualquier editor)

## Instalación

```bash
npm install
```

Esto instala Electron, Express, `xlsx` (lectura de Excel planos), `exceljs` (lectura/escritura del
Excel maestro de 12 pestañas preservando su formato), `fast-xml-parser` (lectura de los XML de los
CFDIs) y AngularJS/`angular-resource` (se sirven directamente desde `node_modules` mediante
Express, sin necesidad de CDN, para que la app funcione sin internet).

## Ejecutar en desarrollo

```bash
npm start
```

Esto:
1. Levanta un servidor Express interno en `http://localhost:4123`.
2. Abre una ventana de Electron que carga esa URL (ahí vive el frontend Angular).

## Estructura del proyecto

```
cfdi-organizer/
├── main.js                        Proceso principal de Electron (ventana + diálogos nativos)
├── preload.js                     Expone window.electronAPI.* al frontend
├── server/
│   ├── app.js                     Configuración de Express (estáticos + rutas API)
│   ├── routes/
│   │   ├── cfdi.routes.js         Endpoints: cargar-excels, pagos/egresos/ingresos (preview+confirmar)
│   │   └── ingresosExcel.routes.js  Endpoint: rellenar Excel de Ingresos (12 pestañas)
│   └── services/
│       ├── excelService.js        Localiza y lee los .xlsx (Emitidos/Recibidos)
│       ├── xmlService.js          Lee un CFDI y extrae Fecha, Total, IdDocumento, FormaDePagoP, etc.
│       ├── organizerService.js    Lógica central: indexar CFDIs, planificar y ejecutar cada proceso
│       └── ingresosExcelService.js  Filtra "Emitidos" y rellena el Excel maestro de 12 pestañas
└── public/                        Frontend Angular
    ├── index.html
    ├── css/styles.css
    └── js/
        ├── app.module.js
        ├── factorys/
        │   ├── cfdiFactory.js
        │   └── ingresosExcelFactory.js
        └── controllers/mainCtrl.js
```

## Flujo de uso
1. **Seleccionar carpetas**: se abre el diálogo nativo de Windows/Mac/Linux (vía Electron) y
   permite elegir **una o varias carpetas** (una por cada mes). Si seleccionas varias, se
   procesan **de una en una**: organizas por completo la carpeta actual (Pagos → Egresos →
   Ingresos) y usas los botones "◀ Carpeta anterior" / "Siguiente carpeta ▶" para avanzar.
2. **Cargar Excel**: por cada carpeta, busca un archivo cuyo nombre contenga "emitid" y otro que
   contenga "recibid" (sin importar mayúsculas). Si no los encuentra así, hay que renombrarlos o
   ajustar la búsqueda en `excelService.encontrarExcels`.
3. Botones **Buscar Pagos → Buscar Egresos → Buscar Ingresos** (Egresos se habilita solo después
   de **confirmar** Pagos, por el motivo explicado abajo). Cada botón:
   - Primero muestra una **vista previa** (cantidades y detalle) sin mover nada.
   - Al dar **Confirmar**, se crean las carpetas y se **mueven** (no copian) los archivos.
   - Al terminar, se muestra un **resumen final** en pantalla.
4. **Pestaña "Buscar pagos de diferentes meses"**: para los CFDIs de pago que quedaron marcados
   `NoEncontradoPago` porque su complemento estaba en otro mes. Aquí seleccionas varias carpetas
   ya organizadas (cada una con su subcarpeta `Pagos`) y el sistema busca, entre todas ellas, el
   complemento faltante. Muestra una vista previa con el archivo de pago y el archivo de
   complemento encontrado (y en qué carpeta está actualmente) antes de mover nada; al confirmar,
   crea la subcarpeta de pago correspondiente (dentro de la carpeta/mes donde vive el complemento; el pago es el que se mueve hacia allá)
   y mueve ahí ambos archivos, renombrándolos con la misma convención de siempre.

## Reglas de negocio implementadas
- **Pagos** (`Tipo = P` en Recibidos): la columna `Tipo` se reconoce de forma flexible — acepta
  `P`, `P - Pago`, `P-Pago`, etc. (cualquier texto que empiece con "P" seguido de espacio, guion o
  fin de cadena; así no se confunde con otros valores como `PUE`). Busca el `IdDocumento` dentro del XML del pago y localiza
  el/los CFDI(s) relacionado(s) en toda la carpeta seleccionada (recursivo, sin importar
  subcarpetas por mes). Si encuentra complemento(s): crea la subcarpeta
  `PAGO [Fecha complemento] Y CP [Fecha pago] COMPRAS [ImpPagado] [FormaDePagoP]` (en MAYÚSCULAS)
  y mueve ahí el pago (renombrado `PAGO ...`) y cada complemento (renombrado `FDC ...`). Si NO
  encuentra complemento: el CFDI se mueve igualmente a la carpeta `Pagos` (sin subcarpeta),
  renombrado con el prefijo `NoEncontradoPago`.
- **Cada pago tiene SIEMPRE su propia subcarpeta**, incluso si el nombre generado coincide con el
  de otro pago distinto: en ese caso, la segunda subcarpeta se crea con un sufijo `(2)`, `(3)`,
  etc. Así cada pago queda emparejado únicamente con su propio complemento.
- **Egresos**: todo lo de Recibidos con `Tipo != P` se mueve a `Egresos` y se **renombra** como
  `PAGADO [Fecha] COMPRAS [Total] [FormaPago] ( uuid-original )` (el texto en MAYÚSCULAS, pero el
  UUID se deja tal cual estaba, generalmente en minúsculas). Ese UUID entre paréntesis se agrega a
  propósito para que "Buscar pagos de diferentes meses" pueda seguir encontrando el archivo por su
  `IdDocumento` aunque ya haya sido renombrado. **Debe ejecutarse después de confirmar Pagos**,
  porque el CFDI complemento (el documento relacionado) normalmente también tiene su propia fila
  en Recibidos con `Tipo != P`; si Egresos corriera primero, ese archivo ya estaría movido (y
  renombrado) y Pagos no podría encontrarlo por su nombre original. Por eso el botón de Egresos
  está deshabilitado hasta confirmar Pagos.
- **Cliente y régimen fiscal (Egresos)**: arriba de la pestaña "Organizar CFDIs" se elige o crea el
  cliente y su régimen (editable en cualquier momento; se guarda en `clientes.json` en la carpeta de
  datos del usuario). Para cada egreso se compara el `RegimenFiscalReceptor` del XML con el del
  cliente: si es distinto, el archivo (con el mismo nombre `PAGADO …`) va a
  `Egresos/Otro regimen (número - nombre)/`, una carpeta por cada régimen distinto. Si el XML no
  trae el régimen (CFDI 3.3), se queda en `Egresos` y la vista previa lo avisa.
- El botón "Corregir nombre de CFDIs egreso" se eliminó: los archivos de Egresos conservan el
  sufijo `( uuid )` en su nombre.
- **Ingresos**: todo lo de Emitidos va a `Ingresos`; si `Estado = CANCELADO` va a
  `Ingresos/Cancelados`. Es independiente del orden de Pagos/Egresos.
- **Búsqueda entre múltiples meses** (pestaña aparte): localiza el archivo `NoEncontradoPago ...`
  dentro de `Pagos` de cada carpeta seleccionada, y busca su complemento en el conjunto de TODAS
  las carpetas seleccionadas (recursivo, incluidas las subcarpetas Ingresos/Egresos/Pagos de esas
  otras carpetas). Reconoce archivos con su nombre original o ya renombrados (`PAGO ...`,
  `FDC ...`, `PAGADO ... ( uuid )`) para no perder la referencia si ya fueron procesados antes.
  **Importante: aquí el PAGO se mueve a donde está su complemento** (al revés que en el proceso de
  una sola carpeta). La subcarpeta se crea siempre dentro de la carpeta **`Pagos`** de la carpeta
  raíz (mes) donde vive el complemento —se crea `Pagos` si todavía no existiera— y ahí se mueven
  ambos archivos, sin importar en qué subcarpeta (Ingresos, Egresos, Pagos u otra) estuviera
  guardado el complemento originalmente. Si un pago tiene más de un complemento en carpetas raíz
  distintas (caso raro), se usa la ubicación del primero encontrado.
- Formato de fecha en nombres: `DD MM YYYY`.
- Catálogo de forma de pago: 01 Efectivo, 02 Cheque, 03 Transferencia (`TRANSF`), 04 Tarjeta de
  crédito, 28 Tarjeta de débito.

## Pestaña "Llenar Excel de Ingresos"

Toma uno o varios Excel de **"Emitidos"** (el mismo tipo de archivo que usa "Organizar CFDIs") y
vuelca su información, ya filtrada, en la pestaña correspondiente de un **Excel maestro con 12
pestañas** (una por mes).

### Cómo funciona
1. **Detección del mes por nombre de archivo**: cada Excel de Emitidos debe **empezar** su nombre
   con el mes (`ENERO`, `Febrero`, `marzoVentas.xlsx`, `Septiembre Emitidos.xlsx`, etc. — no
   importan mayúsculas/minúsculas, acentos, ni lo que venga después del nombre del mes).
2. **Filtro sobre el Excel de Emitidos**: solo se toman las filas donde
   - `Estado` = `VIGENTE` (sin importar mayúsculas/minúsculas), y
   - `Regimen emisor` empieza con el código `612`.
3. **Mapeo de columnas** (de Emitidos → Ingresos):

   | Columna en Ingresos | Columna en Emitidos      |
   |----------------------|--------------------------|
   | FECHA                | Fecha emision            |
   | FOLIO                | UUID                     |
   | CLIENTE               | Razon receptor           |
   | FORMA DE PAGO         | Forma pago                |
   | RFC                   | RFC receptor              |
   | VENTAS 0%          | *(no se llena, por ahora — no hay columna de origen)* |
   | VENTAS 16%             | SubTotal        |
   | IVA                    | IVA Trasladado 16% *(o cualquier columna que empiece con "IVA Trasladado", tolera variaciones como "IVA Trasladado" a secas)* |
   | TOTAL                 | Total                     |

4. **Ubicación de la fila de encabezados**: no está fija en una fila específica (puede variar). El
   programa revisa las primeras 15 filas de cada pestaña y elige la que tenga más coincidencias
   con `FECHA, FOLIO, CLIENTE, FORMA DE PAGO, RFC, VENTAS 0%, VENTAS 16%, IVA, TOTAL` (se exige
   al menos 3 coincidencias para confiar en que sí es esa fila). Los datos se escriben empezando
   en la fila **inmediatamente siguiente** a los encabezados.
5. **Si la pestaña ya tenía datos**, se **sobrescriben**: primero se detecta hasta dónde llegan los
   datos actuales (tolera hasta 5 filas vacías seguidas antes de asumir que ya no hay más), se
   limpian esas celdas (solo las columnas de la tabla — nada fuera de ella) y luego se escriben los
   datos nuevos. La columna `VENTAS 0%` se limpia igual que las demás, pero no se le escribe
   nada nuevo porque por ahora no hay una columna de origen para ese dato.
6. **El archivo original nunca se toca**: todo se hace sobre una copia en memoria; al final se te
   pide (con el diálogo nativo de guardar) dónde quieres guardar el Excel resultante.
7. Si subes varios Excel de Emitidos (ej. Febrero y Noviembre), solo se actualizan esas pestañas;
   las otras 10 quedan exactamente como estaban en el archivo original.

### Validado con archivos reales
Esta lógica se probó (fuera de la app, con un script equivalente) contra un Excel maestro real de
12 pestañas y 3 Excel de Emitidos (Febrero, Marzo, Abril). Detectó correctamente la fila de
encabezados (fila 5, no la 3), encontró las pestañas por nombre (aunque tenían sufijos como
"FEBRERO24" o "MARZO 24"), excluyó los CFDIs `CANCELADO`, y escribió los montos en las columnas
correctas — dejando las demás pestañas (como Enero) intactas.

**Correcciones posteriores sobre la columna IVA**:
- En algunos meses (reportado en Noviembre) el encabezado venía como `"IVA Trasladado"` a secas,
  sin el `"16%"`. La búsqueda ahora es por **prefijo** ("empieza con IVA Trasladado"), no por
  coincidencia exacta, así que reconoce esa variante.
- Si un mismo Excel de Emitidos llegara a tener **más de una** columna que empiece con
  "IVA Trasladado" (por ejemplo si ese mes mezcla varias tasas: 0%, 8%, 16%), se elige la que
  tenga **"16"** en algún lugar del nombre (con %, con espacio, con guion bajo — cualquier
  variante), sin importar el orden en que aparezcan las columnas. Si ninguna trae "16", se usa la
  primera que se encuentre.

### Supuesto a confirmar
Los datos nuevos se escriben empezando justo en la fila después de los encabezados (sin dejar
ningún renglón en blanco de por medio), incluso si esa pestaña en particular normalmente deja una
fila vacía como separador visual. Si tu plantilla necesita ese espacio, dímelo y lo ajusto para que
respete un renglón de por medio.

## Generar el .exe para compartir con alguien más

Ya viene configurado con `electron-builder`. Desde la terminal de VS Code (dentro de la carpeta
del proyecto):

```bash
npm install
npm run dist:win
```

Al terminar, el instalador queda en la carpeta `dist/`, algo como:
```
dist/Organizador de CFDIs Setup 1.0.0.exe
```
Ese es el archivo que le mandas a la otra persona. Al abrirlo, un asistente de instalación (NSIS)
le deja elegir carpeta de instalación y crea un acceso directo en el escritorio; no necesita tener
Node.js ni nada instalado, todo (Electron, Express, Angular, etc.) ya va empaquetado adentro.

Si prefieres un **.exe portátil** (uno solo que corre sin instalar nada, ideal para USB o para no
pedirle permisos de instalación a nadie):
```bash
npm run dist:win-portable
```
El archivo queda igual en `dist/`, como `Organizador de CFDIs 1.0.0.exe` (portable).

### Notas
- La primera vez que corras `npm run dist:win`, `electron-builder` descarga unos binarios
  adicionales (Electron para Windows, NSIS, etc.), así que necesitas internet esa primera vez.
- Puedes compilar el `.exe` de Windows aunque estés en Windows (no hace falta Mac/Linux ni nada
  especial).
- Si quieres cambiarle el ícono de la app, agrega un archivo `build/icon.ico` (256x256 recomendado)
  y añade `"icon": "build/icon.ico"` dentro de `"win"` en el `package.json`.
- Si Windows Defender/SmartScreen marca el instalador como "editor desconocido" al abrirlo en la
  otra computadora, es normal para apps sin firma de código (certificado de firma); la persona
  puede darle "Más información → Ejecutar de todas formas". Para quitar esa advertencia se
  necesitaría comprar un certificado de firma de código, lo cual es opcional.

## Notas y supuestos técnicos (revisar/ajustar según tus CFDIs reales)

- **Lectura de atributos XML**: en vez de depender de una ruta/esquema fijo (namespaces exactos de
  `pago20:`, `pago10:`, etc.), `xmlService.js` hace una búsqueda **recursiva** del atributo por
  nombre (`Fecha`, `Total`, `IdDocumento`, `FormaDePagoP`, `ImpPagado`) en cualquier parte del XML,
  ignorando el prefijo de namespace. Esto lo hace tolerante a variaciones de versión del
  complemento de pagos, pero si tus CFDIs reales usan nombres de atributo distintos, hay que
  ajustarlos ahí.
- **`IdDocumento` múltiple**: si un mismo CFDI de pago tiene más de un documento relacionado
  (`DoctoRelacionado`), se buscan y mueven **todos** los que se logren localizar en la carpeta.
- **Coincidencia por UUID**: se hace por **nombre de archivo** (sin extensión, sin distinguir
  mayúsculas/minúsculas) contra la columna `UUID` del Excel correspondiente — tal como describiste
  que se descargan los CFDIs.
- **Validación de cantidades**: no es bloqueante; el paso de "vista previa" ya muestra cuántos
  archivos se van a mover por categoría para que lo compares visualmente contra tu Excel.
- Esta lógica fue probada con un mini-set de CFDIs de prueba (fechas, `IdDocumento`,
  `FormaDePagoP`, pago sin complemento, cancelado, etc.) y el resultado en disco coincidió
  exactamente con las reglas de nombre especificadas. Aun así, te recomiendo correr una prueba con
  una copia de una carpeta real pequeña antes de usarlo sobre tus archivos originales, ya que el
  proceso **mueve** (no copia) los archivos.

## Próximos pasos sugeridos
- Si quieres previsualizar también el *listado* de archivos (no solo las cantidades) directamente
  en pantalla, el backend ya regresa `detalle` en cada `preview`; solo falta pintarlo en el HTML
  (por ahora el frontend solo muestra los conteos).
