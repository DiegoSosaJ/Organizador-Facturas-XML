'use strict';

angular.module('cfdiOrganizerApp')

.factory('ingresosExcelFactory', function ($resource) {
    var apiRest = '/api/ingresos-excel';

    return {
        rellenar: $resource(apiRest + '/rellenar', {}, {
            'save': { method: 'POST' },
        }),
    };
})
