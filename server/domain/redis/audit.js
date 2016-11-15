'use strict';

var _ = require('underscore'),
    redis = require('redis');

var redisClient = redis.createClient();

module.exports = {
    getFeatureAuditTrail: function(applicationName, featureName, cb) {

        redisClient.lrange('audit:' + applicationName + ':' + featureName, 0, -1, function(err, auditData) {

            var auditTrail = _.map(auditData || [], function (auditEntry) {
                var auditJson = JSON.parse(auditEntry);
                auditJson.createdIndex = auditEntry.createdIndex;
                return auditJson;
            });

            cb(null, auditTrail);
        });
    },

    addApplicationAudit: function (user, applicationName, action, cb) {
        var audit = {
            user: user,
            action: action,
            dateModified: new Date().toISOString()
        };

        var auditJson = JSON.stringify(audit);

        redisClient.lpush('audit:' + applicationName, auditJson, function(err) {
            if (err) cb(err);

            cb();
        });
    },

    addFeatureAudit: function(user, applicationName, featureName, toggleName, value, action, cb) {
        var audit = {
            user: user,
            toggleName: toggleName,
            value: value,
            action: action,
            dateModified: new Date().toISOString()
        };

        var auditJson = JSON.stringify(audit);

        redisClient.lpush('audit:' + applicationName + ':' + featureName, auditJson, function(err) {
            if (err) cb(err);

            cb();
        });
    }
};