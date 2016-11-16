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
        Promise.all([
            getTogglesWithValues('toggle:' + applicationName),
            getDescriptionsMap('meta:' + applicationName)
        ])
        .then(function (applicationToggleData) {
            getCategoriesWithFeatureValues(applicationToggleData[0], applicationToggleData[1])
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

        Promise.all([addFeatureToggle(applicationName, featureName, isMulti, req),
                     addFeatureToggleMeta(applicationName, featureName, metaData)])
            .then(function() {
                cb();
            });
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
                    toggles = JSON.parse(featureValue);
                    toggleSuggestions = getToggleSuggestions(featureMeta, toggles);
                } else {
                    toggles = getSimpleFeatureToggle(featureName, featureValue);
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
        var valueAsJson = JSON.stringify([ value.toString() ]);

        redisClient.set('toggle:' + applicationName + ':' + featureName, valueAsJson, function(err) {
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
    },

    addFeatureToggle: function  (applicationName, featureName, toggleName, req, cb) {
        redisClient.get('toggle:' + applicationName + ':' + featureName, function(err, feature) {
            var featureArray = JSON.parse(feature);
            
            var currentToggleNode = _.find(featureArray, function(node) {
                return node.name === toggleName;
            });

            if (currentToggleNode) {

            } else {
                featureArray.push({ 'name': toggleName, 'value': false });

                redisClient.set('toggle:' + applicationName + ':' + featureName, JSON.stringify(featureArray), function() {

                    hooks.run({
                      fn: 'addFeatureToggle',
                      user: getUserDetails(req),
                      applicationName: applicationName,
                      featureName: featureName,
                      toggleName: toggleName,
                      value: false
                    });

                    cb();
                });
            }
        });    
    },

    updateFeatureMultiToggle: function (applicationName, featureName, toggleName, value, req, cb) {
        redisClient.get('toggle:' + applicationName + ':' + featureName, function(err, feature) {
            var featureArray = JSON.parse(feature);

            _.each(featureArray, function(node, index) {
                if (node.name === toggleName) {
                    featureArray[index].value = value;
                }
            });

            redisClient.set('toggle:' + applicationName + ':' + featureName, JSON.stringify(featureArray), function() {
                hooks.run({
                  fn: 'updateFeatureToggle',
                  user: getUserDetails(req),
                  applicationName: applicationName,
                  featureName: featureName,
                  toggleName: toggleName,
                  value: value
                });

                cb();
            });
        });
    }
};

function getDescriptionsMapObject (node) {
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
    return new Promise(function(resolve, reject) {
        redisClient.keys(keyName + ':*', function(err, toggleKeys) {
            if (toggleKeys.length === 0) {
                resolve([]);
            }

            var results = [];

            _.each(toggleKeys, function(toggleKey) {
                redisClient.get(toggleKey, function (err, toggleData) {
                    if (err) {
                        reject(err);
                    }

                    results.push({ key: toggleKey, value: JSON.parse(toggleData) });

                    if (toggleKeys.length === results.length) {
                        resolve(results);
                    }
                });
            });                     
        });
    });
}

function getDescriptionsMap(keyName) {
    return new Promise(function(resolve, reject) {
        redisClient.keys(keyName + ':*', function(err, toggleKeys) {
            
            if (toggleKeys.length === 0) {
                resolve([]);
            }

            var results = [];

            _.each(toggleKeys, function(toggleKey) {

                redisClient.hgetall(toggleKey, function (err, toggleData) {
                    if (err) {
                        reject(err);
                    }

                    results.push({ key: toggleKey, value: toggleData['description'] });

                    if (toggleKeys.length === results.length) {                 
                        resolve(getDescriptionsMapObject(results));
                    }
                });
            });
        });
    });
}

function isMultiFeature (metaData) {
    return  parseInt(metaData.categoryId) !== category.simpleCategoryId;
};

function getCategoriesWithFeatureValues(applicationToggles, descriptionsMap) {
    return new Promise(function(resolve, reject) {
        var categories = category.getCategoriesFromConfig();
        var featureCount = 0;

        if (applicationToggles.length === 0) {
            return resolve(categories);
        }

        _.each(applicationToggles, function(toggle) {
            getFeature(toggle, descriptionsMap, categories)
                .then(function(feature) {
                    
                    if (feature) {
                        categories[feature.categoryId].features.push(feature);

                        featureCount += 1;
                    }

                    if (featureCount === applicationToggles.length) {
                        return resolve(categories);
                    }
                });
        });
    });
}

function getFeature(node, descriptionMap, categories) {
    return new Promise(function(resolve, reject) {
        var name = getMetaName(node.key);

        var description = descriptionMap[name];

        redisClient.hgetall(name, function(err, toggleMetaData) {

            if (isMultiFeature(toggleMetaData)) {
                return resolve(getMultiFeature(name, node, toggleMetaData, categories, description));
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
    var value = node.value && node.value[0].toLowerCase() === 'true';
    return {
        name: getNodeName(node.key),
        description: metaData.description,
        values: [value],
        categoryId: 0
    };
}

function addFeatureToggle(applicationName, featureName, isMulti, req) {
    return new Promise(function(resolve, reject) {
        var valueAsJson;

        if (isMulti) {
            valueAsJson = JSON.stringify([]);
        } else {
            valueAsJson = JSON.stringify(['false']);
        }

        redisClient.set('toggle:' + applicationName + ':' + featureName, valueAsJson, function(err) {
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

function addFeatureToggleMeta(applicationName, featureName, metaData) {
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
        redisClient.get('toggle:' + applicationName + ':' + featureName, function(err, value) {
            resolve(value);
        });
    });
}

function getSimpleFeatureToggle(featureName, featureValue) {
    return [{
        name: featureName,
        value: JSON.parse(featureValue)[0] === 'true'
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

function getMultiFeature (name, node, metaData, categories, description) {
    var foundCategory = categories[metaData.categoryId];
    var values = _.map(foundCategory.columns, function (column) {
        var columnNode = _.find(node.nodes, function (c) {
            return c.key === node.key + '/' + column;
        });
        return columnNode && columnNode.value && columnNode.value.toLowerCase() === 'true';
    });

    return {
        name: getNodeName(name),
        description: description,
        values: [values],
        categoryId: metaData.categoryId
    };
}

var getToggleSuggestions = function (metaData, toggles) {
    var categories = category.getCategoriesFromConfig();
    return _.difference(categories[metaData.categoryId].columns, _.map(toggles, function (toggle) {
        return toggle.name;
    }));
};