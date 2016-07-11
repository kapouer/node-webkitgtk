var W = require('../');

var list = [];
var len = 10;

var mainCount = 0;
var mainP = start();
while (mainCount++ < 100) mainP = mainP.then(start);

function start() {

	function spawn() {
		return W.load('http://localhost', {content: "<html></html>"}).then(function(view) {
			mem('spawn');
			list.push(view);
			return view;
		});
	}

	var p = Promise.resolve();
	var count = 0;
	while (count++ < len) p = p.then(spawn);

	return p.then(function() {
		var q = Promise.resolve();
		while (list.length) {
			q = q.then(function() {
				mem('destroy');
				return this.destroy();
			}.bind(list.pop()));
		}
		return q;
	}).then(function() {
		list = [];
		var headUsed = mem('finished');
	}).catch(function(err) {
		console.error(err);
	});


	function mem(when) {
		global.gc();
		console.info(process.memoryUsage().heapUsed);
	}
}
