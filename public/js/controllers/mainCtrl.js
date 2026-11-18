'use strict';

angular.module('cfdiOrganizerApp')

.controller('mainCtrl', function ($scope, cfdiFactory, ingresosExcelFactory, clientesFactory) {

    $scope.pestana = 'organizar';

    // --- Cliente y régimen fiscal ---
    $scope.clientes = [];
    $scope.regimenes = [];
    // OJO: se usa un objeto (sel.clienteId) y no un valor suelto: el <select> está dentro de un ng-if,
    // que crea un ámbito hijo, y un valor suelto se copiaría ahí sin llegar a este controlador.
    $scope.sel = { clienteId: null };   // cliente seleccionado
    $scope.modoCliente = null;          // null | 'nuevo' | 'editar'
    $scope.formCliente = { nombre: '', regimenCodigo: '' };
    $scope.formRegimen = { codigo: '', nombre: '', visible: false };
    $scope.mensajeErrorCliente = '';

    function guardarClienteRecordado(id) {
        try { window.localStorage.setItem('cfdi.clienteId', id || ''); } catch (e) { /* sin almacenamiento */ }
    }

    function leerClienteRecordado() {
        try { return window.localStorage.getItem('cfdi.clienteId') || null; } catch (e) { return null; }
    }

    $scope.clienteActual = function () {
        return $scope.clientes.find(function (c) { return c.id === $scope.sel.clienteId; }) || null;
    };

    $scope.nombreRegimen = function (codigo) {
        var r = $scope.regimenes.find(function (x) { return x.codigo === codigo; });
        return r ? codigo + ' - ' + r.nombre : codigo;
    };

    function cargarClientes(idASeleccionar) {
        clientesFactory.listar.get({}, function (resp) {
            if (!resp.meta.success) {
                $scope.mensajeErrorCliente = resp.meta.message;
                return;
            }
            $scope.clientes = resp.data.clientes;
            $scope.regimenes = resp.data.regimenes;
            var id = idASeleccionar || $scope.sel.clienteId || leerClienteRecordado();
            $scope.sel.clienteId = $scope.clientes.some(function (c) { return c.id === id; }) ? id : null;
            // Primera vez (sin clientes): se abre directo el formulario para crear el primero
            if (!$scope.clientes.length && !$scope.modoCliente) $scope.nuevoCliente();
        }, function () {
            $scope.mensajeErrorCliente = 'Error de comunicación con el servidor.';
        });
    }

    $scope.seleccionarCliente = function () {
        guardarClienteRecordado($scope.sel.clienteId);
        $scope.modoCliente = null;
        $scope.mensajeErrorCliente = '';
        // El plan de Egresos depende del régimen del cliente: si cambia, hay que volver a previsualizar
        var egresos = obtenerProceso('egresos');
        if (egresos && !egresos.confirmado) egresos.preview = null;
    };

    $scope.nuevoCliente = function () {
        $scope.modoCliente = 'nuevo';
        $scope.formCliente = { nombre: '', regimenCodigo: '' };
        $scope.mensajeErrorCliente = '';
    };

    $scope.editarCliente = function () {
        var c = $scope.clienteActual();
        if (!c) return;
        $scope.modoCliente = 'editar';
        $scope.formCliente = { nombre: c.nombre, regimenCodigo: c.regimenCodigo };
        $scope.mensajeErrorCliente = '';
    };

    $scope.cancelarFormCliente = function () {
        $scope.modoCliente = null;
        $scope.formRegimen.visible = false;
        $scope.mensajeErrorCliente = '';
    };

    $scope.guardarCliente = function () {
        $scope.mensajeErrorCliente = '';
        var respuesta = function (resp) {
            if (resp.meta.success) {
                $scope.modoCliente = null;
                $scope.formRegimen.visible = false;
                guardarClienteRecordado(resp.data.id);
                cargarClientes(resp.data.id);
                var egresos = obtenerProceso('egresos');
                if (egresos && !egresos.confirmado) egresos.preview = null;
            } else {
                $scope.mensajeErrorCliente = resp.meta.message;
            }
        };
        var falla = function () { $scope.mensajeErrorCliente = 'Error de comunicación con el servidor.'; };

        if ($scope.modoCliente === 'nuevo') {
            clientesFactory.crear.save($scope.formCliente, respuesta, falla);
        } else {
            clientesFactory.actualizar.save({ id: $scope.sel.clienteId }, $scope.formCliente, respuesta, falla);
        }
    };

    $scope.eliminarCliente = function () {
        var c = $scope.clienteActual();
        if (!c || !window.confirm('¿Eliminar al cliente "' + c.nombre + '"? Esto no toca ningún archivo.')) return;
        clientesFactory.eliminar.save({ id: c.id }, {}, function (resp) {
            if (resp.meta.success) {
                $scope.sel.clienteId = null;
                guardarClienteRecordado('');
                cargarClientes();
            } else {
                $scope.mensajeErrorCliente = resp.meta.message;
            }
        });
    };

    $scope.guardarRegimen = function () {
        $scope.mensajeErrorCliente = '';
        clientesFactory.crearRegimen.save($scope.formRegimen, function (resp) {
            if (resp.meta.success) {
                $scope.regimenes.push(resp.data);
                $scope.regimenes.sort(function (a, b) { return a.codigo.localeCompare(b.codigo); });
                $scope.formCliente.regimenCodigo = resp.data.codigo; // queda elegido en el cliente
                $scope.formRegimen = { codigo: '', nombre: '', visible: false };
                $scope.formRegimen.visible = false;
            } else {
                $scope.mensajeErrorCliente = resp.meta.message;
            }
        }, function () {
            $scope.mensajeErrorCliente = 'Error de comunicación con el servidor.';
        });
    };

    $scope.carpetasOrganizar = [];
    $scope.indiceCarpetaActual = 0;
    $scope.carpeta = null;
    $scope.excelsCargados = false;
    $scope.cargandoExcels = false;
    $scope.infoExcels = null;
    $scope.mensajeError = '';

    // --- Buscar pagos de diferentes meses ---
    $scope.carpetasMultiples = [];
    $scope.cargandoPagosMultiples = false;
    $scope.confirmandoPagosMultiples = false;
    $scope.previewPagosMultiples = null;
    $scope.resumenPagosMultiples = null;
    $scope.mensajeErrorMultiples = '';
    $scope.corrigiendoNombresEgresos = false;

    // --- Llenar Excel de Ingresos ---
    $scope.archivosEmitidosIngresos = [];
    $scope.archivoMaestroIngresos = null;
    $scope.anioIngresos = String(new Date().getFullYear());
    $scope.anioValido = function () { return /^\d{4}$/.test(String($scope.anioIngresos || '').trim()); };
    $scope.procesandoRellenoIngresos = false;
    $scope.resumenRellenoIngresos = null;
    $scope.mensajeErrorIngresos = '';

    $scope.procesos = [
        {
            id: 'pagos', nombre: 'Pagos',
            deshabilitado: false, motivoDeshabilitado: '',
            preview: null, resumen: null, cargando: false, confirmando: false, confirmado: false,
        },
        {
            id: 'egresos', nombre: 'Egresos',
            deshabilitado: true, motivoDeshabilitado: 'Primero confirma "Buscar Pagos".',
            preview: null, resumen: null, cargando: false, confirmando: false, confirmado: false,
        },
        {
            id: 'ingresos', nombre: 'Ingresos',
            deshabilitado: false, motivoDeshabilitado: '',
            preview: null, resumen: null, cargando: false, confirmando: false, confirmado: false,
        },
    ];

    var recursos = {
        pagos: cfdiFactory.pagos,
        egresos: cfdiFactory.egresos,
        ingresos: cfdiFactory.ingresos,
    };

    // Traduce las llaves que regresa el backend a etiquetas legibles para el usuario
    var etiquetas = {
        pagos: {
            total: 'Total de pagos (Tipo = P)',
            conComplemento: 'Con complemento encontrado',
            sinComplemento: 'Sin complemento (se marcarán NoEncontradoPago)',
            noEncontradosEnCarpeta: 'No encontrados en la carpeta (no se moverán)',
        },
        egresos: {
            total: 'Total de egresos',
            enRegimenCliente: 'Del régimen del cliente (Egresos)',
            otroRegimen: 'De otro régimen (Egresos/Otro regimen …)',
            sinRegimenEnXml: 'Sin régimen en el XML (CFDI 3.3): se quedan en Egresos',
            noEncontrados: 'No encontrados en la carpeta (no se moverán)',
        },
        ingresos: {
            total: 'Total de ingresos',
            normales: 'Ingresos normales',
            cancelados: 'Cancelados',
            noEncontrados: 'No encontrados en la carpeta (no se moverán)',
        },
    };

    function obtenerProceso(id) {
        return $scope.procesos.find(function (p) { return p.id === id; });
    }

    function reiniciarProcesos() {
        $scope.procesos.forEach(function (p) {
            p.preview = null;
            p.resumen = null;
            p.confirmado = false;
        });
        obtenerProceso('egresos').deshabilitado = true;
        obtenerProceso('egresos').motivoDeshabilitado = 'Primero confirma "Buscar Pagos".';
    }

    function cambiarACarpetaActual() {
        $scope.carpeta = $scope.carpetasOrganizar[$scope.indiceCarpetaActual] || null;
        $scope.excelsCargados = false;
        $scope.infoExcels = null;
        $scope.mensajeError = '';
        reiniciarProcesos();
    }

    // Egresos necesita saber el régimen del cliente; Pagos e Ingresos no.
    $scope.egresosBloqueado = function (proceso) {
        return proceso.id === 'egresos' && !$scope.clienteActual();
    };

    cargarClientes();

    $scope.seleccionarCarpetasOrganizar = function () {
        $scope.mensajeError = '';
        window.electronAPI.seleccionarCarpetas().then(function (rutas) {
            if (!rutas || !rutas.length) return;
            $scope.$apply(function () {
                var eraVacio = $scope.carpetasOrganizar.length === 0;
                rutas.forEach(function (ruta) {
                    if ($scope.carpetasOrganizar.indexOf(ruta) === -1) {
                        $scope.carpetasOrganizar.push(ruta);
                    }
                });
                if (eraVacio) {
                    $scope.indiceCarpetaActual = 0;
                    cambiarACarpetaActual();
                }
            });
        });
    };

    $scope.limpiarCarpetasOrganizar = function () {
        $scope.carpetasOrganizar = [];
        $scope.indiceCarpetaActual = 0;
        $scope.carpeta = null;
        $scope.excelsCargados = false;
        $scope.infoExcels = null;
        $scope.mensajeError = '';
        reiniciarProcesos();
    };

    $scope.irCarpetaAnterior = function () {
        if ($scope.indiceCarpetaActual > 0) {
            $scope.indiceCarpetaActual--;
            cambiarACarpetaActual();
        }
    };

    $scope.irCarpetaSiguiente = function () {
        if ($scope.indiceCarpetaActual < $scope.carpetasOrganizar.length - 1) {
            $scope.indiceCarpetaActual++;
            cambiarACarpetaActual();
        }
    };

    $scope.cargarExcels = function () {
        $scope.mensajeError = '';
        $scope.cargandoExcels = true;

        cfdiFactory.cargarExcels.save({ carpeta: $scope.carpeta }, function (resp) {
            $scope.cargandoExcels = false;
            if (resp.meta.success) {
                $scope.excelsCargados = true;
                $scope.infoExcels = resp.data;
                reiniciarProcesos();
            } else {
                $scope.excelsCargados = false;
                $scope.mensajeError = resp.meta.message;
            }
        }, function () {
            $scope.cargandoExcels = false;
            $scope.mensajeError = 'Error de comunicación con el servidor.';
        });
    };

    $scope.previsualizar = function (id) {
        var proceso = obtenerProceso(id);
        proceso.cargando = true;
        proceso.preview = null;
        proceso.resumen = null;
        $scope.mensajeError = '';

        recursos[id].preview.save({ carpeta: $scope.carpeta, clienteId: $scope.sel.clienteId }, function (resp) {
            proceso.cargando = false;
            if (resp.meta.success) {
                var conteos = {};
                Object.keys(etiquetas[id]).forEach(function (clave) {
                    conteos[etiquetas[id][clave]] = resp.data[clave];
                });
                proceso.preview = { conteos: conteos, detalle: resp.data.detalle };
            } else {
                $scope.mensajeError = resp.meta.message;
            }
        }, function () {
            proceso.cargando = false;
            $scope.mensajeError = 'Error de comunicación con el servidor.';
        });
    };

    $scope.cancelarPreview = function (id) {
        obtenerProceso(id).preview = null;
    };

    $scope.confirmar = function (id) {
        var proceso = obtenerProceso(id);
        proceso.confirmando = true;
        $scope.mensajeError = '';

        recursos[id].confirmar.save({ carpeta: $scope.carpeta }, function (resp) {
            proceso.confirmando = false;
            if (resp.meta.success) {
                proceso.preview = null;
                proceso.resumen = resp.data;
                proceso.confirmado = true;

                if (id === 'pagos') {
                    var egresos = obtenerProceso('egresos');
                    egresos.deshabilitado = false;
                    egresos.motivoDeshabilitado = '';
                }
            } else {
                $scope.mensajeError = resp.meta.message;
            }
        }, function () {
            proceso.confirmando = false;
            $scope.mensajeError = 'Error de comunicación con el servidor.';
        });
    };

    // =====================================================================
    // Buscar pagos de diferentes meses
    // =====================================================================
    $scope.seleccionarCarpetasMultiples = function () {
        $scope.mensajeErrorMultiples = '';
        window.electronAPI.seleccionarCarpetas().then(function (rutas) {
            if (!rutas || !rutas.length) return;
            $scope.$apply(function () {
                // Evita duplicados si el usuario vuelve a seleccionar
                rutas.forEach(function (ruta) {
                    if ($scope.carpetasMultiples.indexOf(ruta) === -1) {
                        $scope.carpetasMultiples.push(ruta);
                    }
                });
                $scope.previewPagosMultiples = null;
                $scope.resumenPagosMultiples = null;
            });
        });
    };

    $scope.limpiarCarpetasMultiples = function () {
        $scope.carpetasMultiples = [];
        $scope.previewPagosMultiples = null;
        $scope.resumenPagosMultiples = null;
        $scope.mensajeErrorMultiples = '';
    };

    $scope.buscarPagosMultiplesCarpetas = function () {
        $scope.mensajeErrorMultiples = '';
        $scope.cargandoPagosMultiples = true;
        $scope.previewPagosMultiples = null;
        $scope.resumenPagosMultiples = null;

        cfdiFactory.pagosMultiples.preview.save({ carpetas: $scope.carpetasMultiples }, function (resp) {
            $scope.cargandoPagosMultiples = false;
            if (resp.meta.success) {
                $scope.previewPagosMultiples = resp.data;
            } else {
                $scope.mensajeErrorMultiples = resp.meta.message;
            }
        }, function () {
            $scope.cargandoPagosMultiples = false;
            $scope.mensajeErrorMultiples = 'Error de comunicación con el servidor.';
        });
    };

    $scope.confirmarPagosMultiplesCarpetas = function () {
        $scope.mensajeErrorMultiples = '';
        $scope.confirmandoPagosMultiples = true;

        cfdiFactory.pagosMultiples.confirmar.save({}, function (resp) {
            $scope.confirmandoPagosMultiples = false;
            if (resp.meta.success) {
                $scope.previewPagosMultiples = null;
                $scope.resumenPagosMultiples = resp.data;
            } else {
                $scope.mensajeErrorMultiples = resp.meta.message;
            }
        }, function () {
            $scope.confirmandoPagosMultiples = false;
            $scope.mensajeErrorMultiples = 'Error de comunicación con el servidor.';
        });
    };

    // =====================================================================
    // Llenar Excel de Ingresos
    // =====================================================================
    $scope.seleccionarArchivosEmitidosIngresos = function () {
        $scope.mensajeErrorIngresos = '';
        window.electronAPI.seleccionarArchivosExcel().then(function (rutas) {
            if (!rutas || !rutas.length) return;
            $scope.$apply(function () {
                rutas.forEach(function (ruta) {
                    if ($scope.archivosEmitidosIngresos.indexOf(ruta) === -1) {
                        $scope.archivosEmitidosIngresos.push(ruta);
                    }
                });
                $scope.resumenRellenoIngresos = null;
            });
        });
    };

    $scope.limpiarArchivosEmitidosIngresos = function () {
        $scope.archivosEmitidosIngresos = [];
        $scope.resumenRellenoIngresos = null;
        $scope.mensajeErrorIngresos = '';
    };

    $scope.seleccionarArchivoMaestroIngresos = function () {
        $scope.mensajeErrorIngresos = '';
        window.electronAPI.seleccionarArchivoExcel().then(function (ruta) {
            if (!ruta) return;
            $scope.$apply(function () {
                $scope.archivoMaestroIngresos = ruta;
                $scope.resumenRellenoIngresos = null;
            });
        });
    };

    $scope.rellenarExcelIngresos = function () {
        $scope.mensajeErrorIngresos = '';

        // "INGRESOS {año} actualizado {dd-mm-yyyy}.xlsx" (Windows no permite "/" en nombres de archivo)
        var hoy = new Date();
        var dos = function (n) { return (n < 10 ? '0' : '') + n; };
        var fechaHoy = dos(hoy.getDate()) + '-' + dos(hoy.getMonth() + 1) + '-' + hoy.getFullYear();
        var nombreSugerido = 'INGRESOS ' + String($scope.anioIngresos).trim() + ' actualizado ' + fechaHoy + '.xlsx';
        window.electronAPI.guardarArchivoExcel(nombreSugerido).then(function (rutaGuardar) {
            if (!rutaGuardar) return; // el usuario canceló el diálogo de guardado

            $scope.$apply(function () {
                $scope.procesandoRellenoIngresos = true;
                $scope.resumenRellenoIngresos = null;
            });

            ingresosExcelFactory.rellenar.save({
                rutaMaestro: $scope.archivoMaestroIngresos,
                archivosEmitidos: $scope.archivosEmitidosIngresos,
                anio: $scope.anioIngresos,
                clienteId: $scope.sel.clienteId,
                rutaGuardar: rutaGuardar,
            }, function (resp) {
                $scope.procesandoRellenoIngresos = false;
                if (resp.meta.success) {
                    $scope.resumenRellenoIngresos = resp.data;
                } else {
                    $scope.mensajeErrorIngresos = resp.meta.message;
                }
            }, function () {
                $scope.procesandoRellenoIngresos = false;
                $scope.mensajeErrorIngresos = 'Error de comunicación con el servidor.';
            });
        });
    };
});
