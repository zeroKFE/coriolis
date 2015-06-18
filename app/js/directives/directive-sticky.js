angular.module('app').directive('sticky', ['$window', function($window) {
  return {
    restrict: 'A',
    scope: true,
    link: function(scope, elem) {
      var el = elem[0];
      var offset = el.getBoundingClientRect().top;
      var fixed = false;

      function updateStyle() {

        if ($window.scrollY > offset) {
          if (!fixed) {
            var width = el.getBoundingClientRect().width;
            el.style.position = 'fixed';
            el.style.top = 0;
            el.style.width = width + 'px';
            fixed = true;
          }
        } else {
          if (fixed) {
            fixed = false;
            el.style.position = null;
            el.style.top = null;
            el.style.width = null;
          }
        }
      }

      angular.element($window).bind('scroll', updateStyle);

      scope.$on('$destroy', function() {
        angular.element($window).unbind('scroll', updateStyle);
      });

    }
 };
}]);
