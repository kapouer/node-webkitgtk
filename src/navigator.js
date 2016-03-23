var W = require('..');

W.load("", function(err, w) {
	w.run(function() {
		function ser(s, d) {
			for (var k in d) {
				var val = d[k];
				if (typeof val == "function") continue;
				else if (typeof val == "object") {
					s[k] = {};
					ser(s[k], val);
				} else {
					s[k] = val;
				}
			}
		}
		var obj = {};
		ser(obj, navigator);
		return obj;
	}, function(err, ua) {
		console.log(JSON.stringify(ua, null, "  "));
		w.destroy(function(err) {
			process.exit();
		});
	});
});

