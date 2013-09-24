/* global App */
var _      = App._;
var qs     = App.Library.querystring;
var url    = App.Library.url;
var path   = App.Library.path;
var escape = require('escape-regexp');
var parser = require('uri-template');

var HTTP_METHODS     = ['get', 'head', 'put', 'post', 'patch', 'delete'];
var RETURN_PROPERTY  = '@return';
var RESERVED_METHODS = _.object(HTTP_METHODS.concat('headers', 'query'), true);

/**
 * Runs validation logic against uri parameters from the RAML spec. Throws an
 * error with the validation issue when the validation fails.
 *
 * @param  {*}      value
 * @param  {Object} param
 * @return {Boolean}
 */
var validateParam = function (value, param) {
  if (param.required === true && value == null) {
    throw new ReferenceError(param.displayName + ' is not defined');
  }

  if (value != null) {
    if (param.type === 'string') {
      // Check the passed in value is a number.
      if (!_.isString(value)) {
        throw new TypeError('Expected a string, but got ' + value);
      }

      // Validate against the enum list.
      if (_.isArray(param.enum) && !_.contains(param.enum, value)) {
        throw new Error([
          'Expected a value of', param.enum.join(', ') + ',',
          'but got', value
        ].join(' '));
      }

      // Validate the string length against the minimum required length.
      var minLength = param.minLength;
      if (minLength === +minLength && value.length < minLength) {
        throw new Error([
          'Expected a minimum length of', minLength + ',',
          'but got a length of', value.length
        ].join(' '));
      }

      // Validate the string length against the maximum allowed length.
      var maxLength = param.maxLength;
      if (maxLength === +maxLength && value.length > maxLength) {
        throw new Error([
          'Expected a maximum length of', maxLength + ',',
          'but got a length of', value.length
        ].join(' '));
      }

      // Validate the string against the pattern.
      if (_.isRegExp(param.pattern) && !param.pattern.test(value)) {
        throw new Error('Expected the value to match ' + param.pattern);
      }
    } else if (param.type === 'integer' || param.type === 'number') {
      if (param.type === 'number') {
        // Validates that the value is a number and not `NaN`.
        if (value !== +value) {
          throw new TypeError('Expected a number, but got' + value);
        }
      } else {
        // Validates that the value is an integer and not `NaN`.
        if (value !== parseInt(value, 10)) {
          throw new TypeError('Expected an integer, but got ' + value);
        }
      }

      if (param.minimum === +param.minimum && value < param.minimum) {
        throw new Error('Expected a value larger than ' + param.minimum +
          ', but got ' + value);
      }

      if (param.maximum === +param.maximum && value > param.maximum) {
        throw new Error('Expected a value smaller than ' + param.minimum +
          ', but got ' + value);
      }
    } else if (param.type === 'date') {
      // Validate that the value is a date.
      if (!_.isDate(value)) {
        throw new TypeError('Expected a date, but got ' + value);
      }
    } else if (param.type === 'boolean') {
      // Validate the value is a boolean.
      if (!_.isBoolean(value)) {
        throw new TypeError('Expected a boolean, but got ' + value);
      }
    }
  }

  return true;
};

/**
 * Simple "template" function for working with the uri param variables.
 *
 * @param  {String}       template
 * @param  {Object}       params
 * @param  {Object|Array} context
 * @return {String}
 */
var template = function (string, params, context) {
  // Nothing to parse.
  if (!params) {
    return string;
  }

  // Transform the params into a regular expression for matching.
  var paramRegex = new RegExp('{(' + _.map(_.keys(params), function (param) {
    return escape(param);
  }).join('|') + ')}', 'g');

  // If the context is an array, we need to replace by match indexes instead of
  // param names.
  if (_.isArray(context)) {
    var index = -1;

    string = string.replace(paramRegex, function (match, param) {
      validateParam(context[++index], params[param]);
      return context[index] == null ? '' : context[index];
    });

    return string;
  }

  string = string.replace(paramRegex, function (match, param) {
    validateParam(context[param], params[param]);
    return context[param] == null ? '' : context[param];
  });

  return string;
};

/**
 * Sanitize the AST from the RAML parser into something easier to work with.
 *
 * @param  {Object} ast
 * @return {Object}
 */
var sanitizeAST = function (ast) {
  // Merge the redundant objects that only have one property each.
  ast.traits        = _.extend.apply(_, ast.traits);
  ast.resourceTypes = _.extend.apply(_, ast.resourceTypes);

  // Recurse through the resources and move URIs to be the key names.
  ast.resources = (function flattenResources (resources) {
    var map = {};

    // Resources are provided as an object, we'll move them to be key based.
    _.each(resources, function (resource) {
      // Methods are implemented as arrays of objects too, but not recursively.
      if (resource.methods) {
        resource.methods = _.object(
          _.pluck(resource.methods, 'method'), resource.methods
        );
      }

      if (resource.resources) {
        resource.resources = flattenResources(resource.resources);
      }

      // Remove the prefixed `/` from the relativeUri.
      map[resource.relativeUri.substr(1)] = resource;
    });

    return map;
  })(ast.resources);

  // Parse the root url and inject variables.
  ast.baseUri = template(ast.baseUri, ast.baseUriParameters, ast);

  // console.log(ast);

  return ast;
};

/**
 * List of all plain HTTP methods in the format from the AST.
 *
 * @type {Object}
 */
var httpMethods = _.chain(HTTP_METHODS).map(function (method) {
    return [method, {
      method: method
    }];
  }).object().value();

/**
 * Returns a function that can be used to make ajax requests.
 *
 * @param  {String}   url
 * @return {Function}
 */
var httpRequest = function (nodes, method) {
  var fullUrl = url.resolve(
    nodes.baseUri, nodes.join('/').replace(/^\/+/, '')
  );

  if (_.isString(nodes.query)) {
    fullUrl = url.resolve(fullUrl, '?' + nodes.query);
  }

  return function (data, done) {
    // No need to pass data through with `GET` or `HEAD` requests.
    if (method === 'get' || method === 'head') {
      data = null;
      done = arguments[0];
    }

    App._executeContext.timeout(Infinity);
    done = done || App._executeContext.async();

    var options = {
      url:     fullUrl,
      data:    typeof data === 'object' ? JSON.stringify(data) : data,
      method:  method.method,
      headers: nodes.headers
    };

    // Trigger the ajax middleware so plugins can hook onto the requests.
    App.middleware.trigger('ajax', options, done);

    return options.xhr;
  };
};

/**
 * Attach the query string helper.
 *
 * @param  {Array}  nodes
 * @param  {Object} context
 * @param  {Object} methods
 * @return {Object}
 */
var attachQuery = function (nodes, context, methods) {
  if ('query' in nodes) {
    return context;
  }

  var routeNodes = _.extend([], nodes, {
    query: null
  });

  context.query = function (query) {
    if (_.isObject(query)) {
      query = qs.stringify(query);
    }

    routeNodes.query = query;
    return attachMethods(routeNodes, {}, methods);
  };

  context.query[RETURN_PROPERTY] = attachMethods(routeNodes, {}, methods);

  return context;
};

/**
 * Attach the headers helper.
 *
 * @param  {Array}  nodes
 * @param  {Object} context
 * @param  {Object} methods
 * @return {Object}
 */
var attachHeaders = function (nodes, context, methods) {
  if ('headers' in nodes) {
    return context;
  }

  var routeNodes = _.extend([], nodes, {
    headers: null
  });

  context.headers = function (headers) {
    if (typeof headers !== 'object') {
      throw new Error('Ajax headers must be provided as an object');
    }

    routeNodes.headers = headers;
    return attachMethods(routeNodes, {}, methods);
  };

  context.headers[RETURN_PROPERTY] = attachMethods(routeNodes, {}, methods);

  return context;
};

/**
 * Attaches executable XHR methods to the context object.
 *
 * @param  {Array}  nodes
 * @param  {Object} context
 * @param  {Object} methods
 * @return {Object}
 */

/* jshint -W003 */
var attachMethods = function (nodes, context, methods) {
  var newContext, routeNodes;

  attachQuery(nodes, context, methods);
  attachHeaders(nodes, context, methods);

  // Iterate over all the possible methods and attach.
  _.each(methods, function (method, verb) {
    context[verb] = httpRequest(nodes, method);
  });

  return context;
};

/**
 * Recurses through a resource object in the RAML AST, generating a dynamic
 * DSL that only allows methods that were defined in the RAML spec.
 *
 * @param  {Array}  nodes     An array of path nodes that can be joined.
 * @param  {Object} context   Where to attach the resource routes.
 * @param  {Object} resources An object of resource routes.
 * @return {Object}           Returns the passed in context object.
 */
var attachResources = function attachResources (nodes, context, resources) {
  _.each(resources, function (resource, route) {
    var routeName = route;
    var resources = resource.resources;
    // Use `extend` to clone the nodes since we attach meta data directly to
    // the nodes.
    var routeNodes   = _.extend([], nodes);
    var templateTags = resource.uriParameters && _.keys(resource.uriParameters);

    routeNodes.push(route);

    if (templateTags && templateTags.length) {
      // The route must end with template tags and have no intermediate text
      // between template tags.
      if (/^\w*(?:\{[^\{\}]+\})+$/.test(route)) {
        var templateCount = templateTags.length;

        // If the route is only a template tag with no static text, use the
        // template tag text as the method name.
        if (templateCount === 1 && '{' + templateTags[0] + '}' === route) {
          routeName = templateTags.pop();
        } else {
          routeName = route.substr(0, route.indexOf('{'));
        }

        // Don't add reserved methods to the context. This is done to avoid
        // potentially confusing use cases. *Was it `get` to make the request
        // or to set the path?*
        if (_.has(RESERVED_METHODS, routeName)) {
          return false;
        }

        // The route is dynamic, so we set the route name to be a function
        // which accepts the template arguments and updates the path fragment.
        // We'll extend any route already at the same namespace so we can do
        // things like use both `/{route}` and `/route`, if needed.
        context[routeName] = _.extend(function () {
          if (arguments.length < templateCount) {
            throw new Error([
              'Insufficient parameters, expected at least',
              templateCount, 'arguments'
            ].join(' '));
          }

          // Change the last path fragment to the proper template text.
          routeNodes[routeNodes.length - 1] = template(
            route, resource.uriParameters, _.toArray(arguments)
          );

          var newContext = {};
          attachMethods(routeNodes, newContext, resource.methods);
          return attachResources(routeNodes, newContext, resources);
        }, context[routeName]);

        var returnPropContext = {};
        attachMethods(routeNodes, returnPropContext, resource.methods);
        attachResources(routeNodes, returnPropContext, resources);
        return context[routeName][RETURN_PROPERTY] = returnPropContext;
      } else {
        return false;
      }
    }

    // If the route is only static text we can easily add the next route.
    var newContext = context[routeName] || (context[routeName] = {});
    attachMethods(routeNodes, newContext, resource.methods);
    return attachResources(routeNodes, newContext, resources);
  });

  return context;
};

/**
 * Generate the client object from a sanitized AST object.
 *
 * @param  {Object} ast
 * @return {Object}
 */
var generateClient = function (ast) {
  var nodes = _.extend([], {
    baseUri: ast.baseUri
  });

  /**
   * The root client implementation is simply a function. This allows us to
   * enter a custom path that may not be supported by the DSL and run any
   * method regardless of whether it was defined in the spec.
   *
   * @param  {String} path
   * @param  {Object} context
   * @return {Object}
   */
  var client = function (path, context) {
    var route = parser.parse(path).expand(context || {}).split('/');
    return attachMethods(_.extend([], nodes, route), {}, httpMethods);
  };

  // Enable the `@return` property used by the completion plugin.
  client[RETURN_PROPERTY] = attachMethods(nodes, {}, httpMethods);

  // Attach all the resources to the returned client function.
  attachResources(nodes, client, ast.resources);

  return client;
};

/**
 * Exports the client generator, which accepts the AST of a RAML document.
 *
 * @return {Object} Dynamic object for constructing API requests from the AST.
 */
module.exports = function (ast) {
  return generateClient(sanitizeAST(ast));
};
