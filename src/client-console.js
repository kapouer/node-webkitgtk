module.exports = function consoleEmitter(emit) {
	if (!window.console) return;
	window.console.trace = function() {
		var args = Array.from(arguments);
		args.push(new Error());
		args = ['console', 'trace'].concat(args);
		emit.apply(null, args);
	};
	['log', 'error', 'info', 'warn'].forEach(function(meth) {
		window.console[meth] = function() {
			var args = ['console', meth].concat(Array.from(arguments));
			emit.apply(null, args);
		};
	});
};
