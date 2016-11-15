'use strict';

var _ = require('underscore'),
    audit = require('./../audit'),
    redis = require('redis'),
    config = require('./../../../config/config.json');

var redisClient = redis.createClient();

var getUserDetails = function (req) {
    return config.RequiresAuth ? req.user._json : {name: 'Anonymous'};
};

module.exports = {
    getApplications: function (cb) {
        redisClient.lrange('applications', 0, -1, function(err, applications) {

            if (err) {
                return cb(err);
            }

            cb(null, applications);
        });
    },

    addApplication: function (applicationName, req, cb) {
        redisClient.lpush('applications', applicationName, function(err) {
            if (err) {
                return cb(err);
            }

            audit.addApplicationAudit(getUserDetails(req), applicationName, 'Created', function () {
                if (err) {
                    console.log(err);
                }
            });

            cb();
        });
    },

    deleteApplication: function (applicationName, req, cb) {
        redisClient.lrem('applications', 0, applicationName, function(err) {
            if (err) {
                return cb(err);
            }

            redisClient.keys('*:' + applicationName + ':*', function(err, keys) {
                if (keys.length > 0) {
                    _.each(keys, function(key) {

                        redisClient.del(key, function(err) {
                            if (err) {
                                return cb(err);
                            }
                        });
                    });
                }
            });

            audit.addApplicationAudit(getUserDetails(req), applicationName, 'Deleted', function () {
                if (err) {
                    console.log(err);
                }
            });
        });

        cb();
    },

    getApplicationMetaData: function (applicationName, cb) {
        //todo

        cb();
    },

    deleteApplicationMetaData: function (applicationName, cb) {
        //todo

        cb();
    },

    saveApplicationMetaData: function (applicationName, metaDataKey, metaDataValue, cb) {
        //todo

        cb();
    }
};