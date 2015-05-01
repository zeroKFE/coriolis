angular.module('app').service('Persist', ['lodash', function (_) {
  var LS_KEY = 'builds';

  var buildJson = localStorage.getItem(LS_KEY);

  if (buildJson) {
    this.builds = angular.fromJson(localStorage.getItem(LS_KEY));
  } else {
    this.builds = {};
  }

  /**
   * Persist a ship build in local storage.
   *
   * @param  {string} shipId The unique id for a model of ship
   * @param  {string} name   The name of the build
   * @param  {string} code   The serialized code
   */
  this.saveBuild = function (shipId, name, code) {
    if (!this.builds[shipId]) {
      this.builds[shipId] = {};
    }

    this.builds[shipId][name] = code;
    localStorage.setItem(LS_KEY, angular.toJson(this.builds));  // Persist updated build collection to localstorage
  }

  /**
   * Get the serialized code/string for a build. Returns null if a
   * build is not found.
   *
   * @param  {string} shipId The unique id for a model of ship
   * @param  {string} name   The name of the build
   * @return {string}        The serialized build string.
   */
  this.getBuild = function (shipId, name) {
    if (this.builds[shipId]) {
      return this.builds[shipId][name];
    }
    return null;
  }

  /**
   * Delete a build from local storage. It will also delete the ship build collection if
   * it becomes empty
   *
   * @param  {string} shipId The unique id for a model of ship
   * @param  {string} name   The name of the build
   */
  this.deleteBuild = function (shipId, name) {
    delete build[shipId][name];
    if (Object.keys(build[shipId]).length == 0) {
      delete build[shipId];
    }
  }


}]);