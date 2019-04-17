module.exports = function errorEmitter(emit) {
	var lastError;
	var OriginalError = window.Error;
	window.Error = function Error(message) {
		var err = new OriginalError(message);
		Object.assign(this, err);
		var isParent = Object.getPrototypeOf(this) == Error.prototype;
		this.stack = err.stack.split('\n').slice(isParent ? 1 : 2).join('\n    ');
		this.message = err.message;
		this.name = err.name;
		lastError = this;
		return this;
	};
	Error.prototype = Object.create(OriginalError.prototype);
	Error.prototype.constructor = Error;

	window.URIError = function URIError(message) {
		Error.call(this, message);
		this.name = arguments.callee.name;
		return this;
	};
	URIError.prototype = Object.create(Error.prototype);
	URIError.prototype.constructor = URIError;

	window.TypeError = function TypeError(message) {
		Error.call(this, message);
		this.name = arguments.callee.name;
		return this;
	};
	TypeError.prototype = Object.create(Error.prototype);
	TypeError.prototype.constructor = TypeError;

	window.SyntaxError = function SyntaxError(message) {
		Error.call(this, message);
		this.name = arguments.callee.name;
		return this;
	};
	SyntaxError.prototype = Object.create(Error.prototype);
	SyntaxError.prototype.constructor = SyntaxError;

	window.ReferenceError = function ReferenceError(message) {
		Error.call(this, message);
		this.name = arguments.callee.name;
		return this;
	};
	ReferenceError.prototype = Object.create(Error.prototype);
	ReferenceError.prototype.constructor = ReferenceError;

	window.RangeError = function RangeError(message) {
		Error.call(this, message);
		this.name = arguments.callee.name;
		return this;
	};
	RangeError.prototype = Object.create(Error.prototype);
	RangeError.prototype.constructor = RangeError;

	window.EvalError = function EvalError(message) {
		Error.call(this, message);
		this.name = arguments.callee.name;
		return this;
	};
	EvalError.prototype = Object.create(Error.prototype);
	EvalError.prototype.constructor = EvalError;

	window.Error.prototype.toJSON = OriginalError.prototype.toJSON = function() {
		var obj = Object.assign({}, this);
		if (this.stack) {
			delete obj.line;
			delete obj.column;
			delete obj.sourceURL;
			obj.stack = this.stack;
		}
		obj.name = this.name;
		obj.message = this.message;
		return obj;
	};
	window.onerror = function(message, file, line, col, err) {
		var ret = ["error", message, file, line, col];
		if (!err && lastError) {
			err = lastError;
			lastError = null;
		}
		ret.push(err);
		emit.apply(null, ret);
	};
};
