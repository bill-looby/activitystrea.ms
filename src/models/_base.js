/**
 * Copyright 2013 International Business Machines Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Utility library for working with Activity Streams Actions
 * Requires underscorejs.
 *
 * @author James M Snell (jasnell@us.ibm.com)
 */
var vocabs        = require('linkeddata-vocabs');
var LanguageTag   = require('rfc5646');
var utils         = require('../utils');
var models        = require('../models');
var jsonld        = require('../_jsonld');
var LanguageValue = require('./_languagevalue');
var checkCallback = utils.checkCallback;
var throwif       = utils.throwif;

function is_literal(item) {
  return item && item['@value'];
}

function Base(expanded, reasoner, parent) {
  if (!(this instanceof Base))
    return new Base(expanded, reasoner);
  utils.hidden(this, '_expanded', expanded);
  utils.hidden(this, '_reasoner', reasoner);
  if (parent) {
    utils.hidden(this, '_parent', parent);
  }
  utils.hidden(this, '_cache', {});
}
Base.prototype = {
  get id() {
    return this._expanded['@id'];
  },
  get type() {
    var types = this._expanded['@type'];
    if (!types) return undefined;
    return types.length === 0 ? undefined :
           types.length === 1 ? types[0] :
           types;
  },
  has : function(key) {
    key = utils.parsed_url(vocabs.as[key]||key);
    var ret = this._expanded[key];
    return ret && ret.length;
  },
  get : function(key) {
    var self = this;
    var n, l, ret;
    key = utils.parsed_url(vocabs.as[key]||key);
    if (!this._cache.hasOwnProperty(key)) {
      var res = this._expanded[key] || [];
      if (!res.length) return undefined;
      if (this._reasoner.is_language_property(key)) {
        ret = LanguageValue.Builder();
        for (n = 0, l = res.length; n < l; n++) {
          var value = res[n]['@value'];
          var lang = res[n]['@language'];
          if (lang) ret.set(lang, value);
          else ret.setDefault(value);
        }
        this._cache[key] = ret.get();
      } else {
        ret = res.map(function(item) {
          if (is_literal(item)) {
            var type = item['@type'];
            var value = item['@value'];
            if (type) {
              if (self._reasoner.is_number(type))
                value = Number(value).valueOf();
              else if (self._reasoner.is_date(type))
                value = new Date(value);
              else if (self._reasoner.is_boolean(type))
                value = value != 'false';
            }
            return value;
          }
          return models.wrap_object(item, self._reasoner, self);
        });
        this._cache[key] = 
          this._reasoner.is_functional(key) ?
            ret[0] : ret;
      }
    }
    return this._cache[key];
  },
  export : function(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    options = options || {};
    checkCallback(callback);
    var self = this;
    process.nextTick(function() {
      jsonld.compact(
        self._expanded,
        callback,
        options.additional_context);
    });
  },
  write : function(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    options = options || {};
    this.export(options, function(err,doc) {
      if (err) {
        callback(err);
        return;
      }
      callback(null, JSON.stringify(doc,null,options.space));
    });
  },
  prettyWrite : function(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    options = options || {};
    options.space = 2;
    this.write(options, callback);
  }
};

// ******** BUILDER ********* //

Base.Builder = function(reasoner, types, base) {
  if (!(this instanceof Base.Builder))
    return new Base.Builder(reasoner, types, base);
  base = base || new Base({}, reasoner);
  utils.hidden(this, '_base', base);
  utils.hidden(this, '_reasoner', reasoner);
  utils.hidden(this, '_expanded', base._expanded);
  this.type(types);
};
Base.Builder.prototype = {
  id : function(id) {
    if (!id) {
      delete this._expanded['@id'];
    } else {
      this._expanded['@id'] = id;
    }
    return this;
  },
  type : function(type) {
    if (!type) {
      delete this._expanded['@type'];
    } else {
      var ret = [];
      if (!Array.isArray(type)) type = [type];
      for (var n = 0, l = type.length; n < l; n++) {
        ret.push(type[n].valueOf());
      }
      this._expanded['@type'] = ret;
    }
    return this;
  },
  set : function(key, val, options) {
    var _reasoner = this._reasoner;
    var _expanded = this._expanded;
    var options = options || {};
    if (val instanceof Base.Builder) {
      val = val.get();
    }
    var n, l;
    key = utils.parsed_url(vocabs.as[key]||key);
    if (val === null || val === undefined) {
      delete _expanded[key];
    } else {
      var is_array = Array.isArray(val);
      if (_reasoner.is_functional(key)) {
        throwif(is_array, 'Functional properties cannot have array values');
        delete _expanded[key];
      }
      this._expanded[key] = this._expanded[key] || [];
      if (!is_array) val = [val];
      for (n = 0, l = val.length; n < l; n++) {
        if (_reasoner.is_object_property(key) || val[n] instanceof Base) {
          if (val[n] instanceof Base) {
            this._expanded[key].push(val[n]._expanded);
          } else if (utils.is_string(val[n])) {
            this._expanded[key].push({'@id': val[n]});
          } else if (typeof val[n] === 'object') {
            var builder = Base.Builder(_reasoner);
            var keys = Object.keys(val[n]);
            for (n = 0, l = keys.length; n < l; n++) {
              var k = keys[n];
              var value = val[n][k];
              if (k === '@id') builder.id(value);
              else if (k === '@type') builder.type(value);
              else builder.set(k, value);
            }
            this._expanded[key].push(builder.get()._expanded);
          } else {
            throw new Error('Invalid object property type');
          }
        } else {
          var lang = options.lang;
          var type = options.type;
          var ret = {
            '@value': val[n]
          };
          if (lang) ret['@language'] = lang;
          if (type) ret['@type'] = type;
          this._expanded[key].push(ret);
        }
      }
    }
    return this;
  },
  get : function() {
    return this._base;
  }
};

module.exports = Base;