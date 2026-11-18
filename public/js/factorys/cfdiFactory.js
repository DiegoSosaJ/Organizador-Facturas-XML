'use strict';

angular.module('cfdiOrganizerApp')

.factory('cfdiFactory', function ($resource) {
    var apiRest = '/api/cfdi';

    return {
        cargarExcels: $resource(apiRest + '/cargar-excels', {}, {
            'save': { method: 'POST' },
        }),
        pagos: {
            preview: $resource(apiRest + '/pagos/preview', {}, { 'save': { method: 'POST' } }),
            confirmar: $resource(apiRest + '/pagos/confirmar', {}, { 'save': { method: 'POST' } }),
        },
        egresos: {
            preview: $resource(apiRest + '/egresos/preview', {}, { 'save': { method: 'POST' } }),
            confirmar: $resource(apiRest + '/egresos/confirmar', {}, { 'save': { method: 'POST' } }),
        },
        ingresos: {
            preview: $resource(apiRest + '/ingresos/preview', {}, { 'save': { method: 'POST' } }),
            confirmar: $resource(apiRest + '/ingresos/confirmar', {}, { 'save': { method: 'POST' } }),
        },
        pagosMultiples: {
            preview: $resource(apiRest + '/pagos-multiples/preview', {}, { 'save': { method: 'POST' } }),
            confirmar: $resource(apiRest + '/pagos-multiples/confirmar', {}, { 'save': { method: 'POST' } }),
        },
    };
})
