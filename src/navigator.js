var W = require('..');

W.load("", function(err, w) {
	w.run('navigator', function(err, ua) {
		console.log(JSON.stringify(ua));
		w.destroy(function(err) {
			process.exit();
		});
	});
});

