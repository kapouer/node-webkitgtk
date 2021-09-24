const W = require('..');

W.load("", (err, w) => {
	w.run(() => {
		function ser(s, d) {
			for (const k in d) {
				const val = d[k];
				if (typeof val == "function") continue;
				else if (typeof val == "object") {
					s[k] = {};
					ser(s[k], val);
				} else {
					s[k] = val;
				}
			}
		}
		const obj = {};
		ser(obj, navigator);
		return obj;
	}, (err, ua) => {
		// eslint-disable-next-line no-console
		console.log(JSON.stringify(ua, null, "  "));
		w.destroy((err) => {
			process.exit();
		});
	});
});

