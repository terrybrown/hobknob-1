"use strict";

 angular.module("config", [])

.constant("ENV", {
  "RequiresAuth": false,
  "name": "development",
  "etcdUri": "http://127.0.0.1:4001",
  "etcdVersion": "v1",
  "etcdCoreVersion": "v2",
  "etcdHost": "127.0.0.1",
  "etcdPort": "4001"
})

;