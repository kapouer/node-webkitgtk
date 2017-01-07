module.exports = function consoleEmitter(emit) {
	if (!window.console) return;
	var sharedConsoleMethods = [
		'assert',
		'dir',
		'error',
		'info',
		'log',
		'time',
		'timeEnd',
		'warn'
	];

	sharedConsoleMethods.forEach(function(meth) {
		window.console[meth] = function() {
			var args = ['console', meth].concat(Array.from(arguments));
			emit.apply(null, args);
		};
	});
	window.console.trace = function() {
		var args = Array.from(arguments);
		args.push(new Error());
		args = ['console', 'trace'].concat(args);
		emit.apply(null, args);
	};
};
