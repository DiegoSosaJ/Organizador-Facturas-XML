'use strict';

angular.module('cfdiOrganizerApp')

.factory('clientesFactory', function ($resource) {
    var apiRest = '/api/clientes';

    return {
        listar: $resource(apiRest, {}, { 'get': { method: 'GET' } }),
        crear: $resource(apiRest, {}, { 'save': { method: 'POST' } }),
        crearRegimen: $resource(apiRest + '/regimenes', {}, { 'save': { method: 'POST' } }),
        actualizar: $resource(apiRest + '/:id/actualizar', { id: '@id' }, { 'save': { method: 'POST' } }),
        eliminar: $resource(apiRest + '/:id/eliminar', { id: '@id' }, { 'save': { method: 'POST' } }),
    };
})
