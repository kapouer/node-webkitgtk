module.exports = function errorEmitter(emit) {
	let lastError;
	const OriginalError = window.Error;
	OriginalError.prototype.toJSON = function () {
		const obj = Object.assign({}, this);
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
	window.Error = class Error extends OriginalError {
		constructor(msg) {
			super(msg);
			const isParent = Object.getPrototypeOf(this) == Error.prototype;
			this.stack = this.stack.split('\n').slice(isParent ? 1 : 2).join('\n    ');
			lastError = this;
		}
	};
	for (const ErrName of ['URI', 'Type', 'Syntax', 'Reference', 'Range', 'Eval']) {
		const name = `${ErrName}Error`;
		window[name] = class extends Error {
			constructor(msg) {
				super(msg);
				this.name = name;
			}
		};
	}

	window.onerror = function(message, file, line, col, err) {
		const ret = ["error", message, file, line, col];
		if (!err && lastError) {
			err = lastError;
			lastError = null;
		}
		ret.push(err);
		emit.apply(null, ret);
	};
};
