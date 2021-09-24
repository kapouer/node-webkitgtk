module.exports = function consoleEmitter(emit) {
	if (!window.console) return;
	const sharedConsoleMethods = [
		'assert',
		'dir',
		'error',
		'info',
		'log',
		'time',
		'timeEnd',
		'trace',
		'warn'
	];

	sharedConsoleMethods.forEach((meth) => {
		if (window.console[meth]) window.console[meth] = function() {
			const args = ['console', meth].concat(Array.from(arguments));
			emit.apply(null, args);
		};
	});
	if (!window.console.trace) window.console.trace = function() {
		let args = Array.from(arguments);
		args.push(new Error());
		args = ['console', 'trace'].concat(args);
		emit.apply(null, args);
	};
};
