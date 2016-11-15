'use strict';

var _ = require('underscore'),
    category = require('./../category'),
    hooks = require('../../src/hooks/featureHooks'),
    config = require('./../../../config/config.json'),
    redis = require('redis'),
    Promise = require('promise');

var redisClient = redis.createClient();

var getUserDetails = function (req) {
    return config.RequiresAuth ? req.user._json : {name: 'Anonymous'};
};

module.exports = {
    getFeatureCategories: function (applicationName, cb) {

        var toggleValues = getTogglesWithValues('toggle:' + applicationName);
        var toggleDescriptions = getTogglesDescriptions('meta:' + applicationName);

        Promise.all([toggleValues, toggleDescriptions])
            .then(function (toggleData) {

                var descriptionsMap = getDescriptionsMap(toggleData[1]);

                getCategoriesWithFeatureValues(toggleData[0], descriptionsMap)
                    .then(function(categories) {

                        cb(null, {
                            categories: categories
                        });
                    });
            });
    },

    addFeature: function (applicationName, featureName, featureDescription, categoryId, req, cb) {

        var metaData = {
            categoryId: categoryId,
            description: featureDescription
        };

        var isMulti = isMultiFeature(metaData);

        if (isMulti) {
            //todo
        } else {
            Promise.all([addSimpleFeature(applicationName, featureName, req),
                         addSimpleFeatureMeta(applicationName, featureName, metaData)])
                .then(function() {
                    cb();
                });
        }
    },

    getFeature: function (applicationName, featureName, cb) {

        var featureMetaPromise = getFeatureMeta(applicationName, featureName);
        var featureValuePromise = getFeatureValue(applicationName, featureName);

        Promise.all([featureMetaPromise, featureValuePromise])
            .then(function(featureData) {

                var featureMeta = featureData[0];
                var featureValue = featureData[1];

                var isMulti = isMultiFeature(featureMeta);

                var toggles;
                var toggleSuggestions;

                if (isMulti) {
                    //todo
                } else {
                    toggles = getSimpleFeatureToggle(featureName, featureValue.value);
                }

                cb(null, {
                    applicationName: applicationName,
                    featureName: featureName,
                    featureDescription: featureMeta.description,
                    toggles: toggles,
                    isMultiToggle: isMulti,
                    toggleSuggestions: toggleSuggestions
                });
            });
    },

    deleteFeature: function (applicationName, featureName, req, cb) {

        deleteFeatureAndMetaData(applicationName, featureName)
            .then(function() {
                hooks.run({
                    fn: 'deleteFeature',
                    user: getUserDetails(req),
                    applicationName: applicationName,
                    featureName: featureName
                });

                cb();
            });
    },

    updateFeatureToggle: function (applicationName, featureName, value, req, cb) {

        redisClient.hset('toggle:' + applicationName + ':' + featureName, 'value', value, function(err) {
            if (err) {
                cb(err);
            }

            hooks.run({
                fn: 'updateFeatureToggle',
                user: getUserDetails(req),
                applicationName: applicationName,
                featureName: featureName,
                toggleName: null,
                value: value
            });

            cb();
        })
    },

    updateFeatureDescription: function (applicationName, featureName, newFeatureDescription, req, cb) {

        redisClient.hset('meta:' + applicationName + ':' + featureName, 'description', newFeatureDescription, function(err) {
            if (err) {
                cb(err);
            }

            cb();
        });
    }
};

function getDescriptionsMap (node) {
    var descriptions = _.map(node, function (descriptionNode) {
        return [getNodeName(descriptionNode.key), descriptionNode.value];
    });

    return _.object(descriptions);
};

var getNodeName = function (node) {
    var splitKey = node.split(':');
    return splitKey[splitKey.length - 1];
};

function getTogglesWithValues(keyName) {
    return getHashDataForToggle(keyName, 'value');
}

function getTogglesDescriptions(keyName) {
    return getHashDataForToggle(keyName, 'description');
}

function isMultiFeature (metaData) {
    return  parseInt(metaData.categoryId) !== category.simpleCategoryId;
};

function getHashDataForToggle(keyName, valueName) {

    return new Promise(function(resolve, reject) {
        redisClient.keys(keyName + ':*', function(err, toggleKeys) {
            
            if (toggleKeys.length === 0) {
                resolve([]);
            }

            var results = [];

            _.each(toggleKeys, function(toggleKey) {

                redisClient.hgetall(toggleKey, function (err, toggleData) {
                    if (err) reject(err);

                    results.push({ key: toggleKey, value: toggleData[valueName] });

                    if (toggleKeys.length === results.length) {
                        resolve(results);
                    }
                });
            });
        });
    });
}

function getCategoriesWithFeatureValues(applicationNode, descriptionsMap) {

    return new Promise(function(resolve, reject) {

        var categories = category.getCategoriesFromConfig();
        var featureCount = 0;

        if (applicationNode.length === 0) {
            return resolve(categories);
        }

        _.each(applicationNode, function(featureNode) {
            getFeature(featureNode, descriptionsMap)
                .then(function(feature) {

                    if (feature) {

                        categories[feature.categoryId].features.push(feature);

                        featureCount += 1;
                    }

                    if (featureCount === applicationNode.length) {
                        return resolve(categories);
                    }
                });
        });
    });
}

function getFeature(node, descriptionMap) {

    return new Promise(function(resolve, reject) {
        var name = getMetaName(node.key);

        var description = descriptionMap[name];

        redisClient.hgetall(name, function(err, toggleMetaData) {

            if (isMultiFeature(toggleMetaData)) {
                return resolve(getMultiFeature(name, node, metaData, categories, description));
            }

            return resolve(getSimpleFeature(node, toggleMetaData));
        });
    });
}

function getMetaName(node) {
    var splitKey = node.split(':');
    return 'meta:' + splitKey[1] + ':' + splitKey[2];
}

function getSimpleFeature(node, metaData) {

    var value = node.value && node.value.toLowerCase() === 'true';
    return {
        name: getNodeName(node.key),
        description: metaData.description,
        values: [value],
        categoryId: 0
    };
}

function addSimpleFeature(applicationName, featureName, req) {

    return new Promise(function(resolve, reject) {
        redisClient.hmset('toggle:' + applicationName + ':' + featureName, { 'value': 'false' }, function(err) {
            if (err) {
                reject(err);
            }

            hooks.run({
                fn: 'addFeatureToggle',
                user: getUserDetails(req),
                applicationName: applicationName,
                featureName: featureName,
                toggleName: null,
                value: false
            });

            resolve();
        });
    });
}

function addSimpleFeatureMeta(applicationName, featureName, metaData) {
    return new Promise(function(resolve, reject) {
        redisClient.hmset('meta:' + applicationName + ':' + featureName, metaData, function(err) {
            if (err) {
                reject(err);
            }

            resolve();
        });
    });
}

function getFeatureMeta(applicationName, featureName) {
    return new Promise(function(resolve, reject) {
        redisClient.hgetall('meta:' + applicationName + ':' + featureName, function(err, metaData) {
            resolve(metaData);
        });
    });
}

function getFeatureValue(applicationName, featureName) {
    return new Promise(function(resolve, reject) {
        redisClient.hgetall('toggle:' + applicationName + ':' + featureName, function(err, value) {
            resolve(value);
        });
    });
}

function getSimpleFeatureToggle(featureName, featureValue) {
    return [{
        name: featureName,
        value: featureValue === 'true'
    }];
}

function deleteFeatureAndMetaData(applicationName, featureName) {
    return new Promise(function(resolve, reject){
        redisClient.del('toggle:' + applicationName + ':' + featureName, function(err) {
            if (err) {
                reject(err);
            }
            
            redisClient.del('meta:' + applicationName + ':' + featureName, function(err) {
                if (err) reject(err);

                resolve();
            })
        });
    });
}