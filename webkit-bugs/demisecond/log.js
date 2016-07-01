var W = require('../..');

var pageData = require('fs').readFileSync('front.html');

var inst = new W();

inst.init(function() {
	instLoad(inst, 1, function() {
		process.exit(0);
	});
});


function instLoad(inst, num, cb) {
	console.time('load'+num);
	inst.load('http://localhost:3000/lefigaro.fr/1234/read', {
    "auto-load-images": false,
		stall: 150,
    runTimeout: 150,
    stallTimeout: 50,
		stallInterval: 50,
		content: pageData
	}).once('idle', function() {
		console.timeEnd('load'+num);
		inst.reset(function() {
			setTimeout(function() {
				if (num < 100) instLoad(inst, num+1, cb);
				else cb();
			}, 180);
		});
	});
}
