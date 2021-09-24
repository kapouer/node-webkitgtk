const WebKit = require('../');
const expect = require('expect.js');

describe("preload method", () => {
	it("should not run scripts", (done) => {
		const doc = '<html><head><script>\
		document.writeln("<meta name=\'test\'></meta>");\
		</script><script type="text/javascript" src="test.js"></script>\
		<script src="test.js"></script></head>\
		<body onload="document.body.appendChild(document.createTextNode(\'toto\'))">\
		<script type="text/javascript">document.writeln("<p>there</p>");</script>\
		</body></html>';
		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test.js") {
				res.statusCode = 200;
				res.end('document.documentElement.className="toto";');
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			WebKit((err, w) => {
				w.preload("http://localhost:" + server.address().port, {console:true})
					.when('ready', function(cb) {
						this.run((done) => {
							const script = document.createElement('script');
							script.textContent = 'document.body.innerHTML += "blah";';
							document.head.appendChild(script);
							script.remove();
							done();
						}, cb);
					})
					.once('load', function() { this.html((err, str) => {
						expect(str.indexOf('blah</body>')).to.be.greaterThan(0);
						str = str.replace('blah</body>', '</body>');
						expect(str).to.be(doc);
						setTimeout(() => {
							server.close();
							done();
						}, 100);
					});});
			});
		});
	});

	it("cannot prevent inserted inline script (using .run()) from being run", (done) => {
		const doc = '<html><head></head><body></body></html>';
		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			WebKit((err, w) => {
				w.preload("http://localhost:" + server.address().port, {console:true})
					.when('ready', function(cb) {
						this.run((done) => {
							const script = document.createElement('script');
							script.textContent = 'document.body.innerHTML = "blah";';
							document.head.appendChild(script);
							script.remove();
							done();
						}, cb);
					})
					.once('load', function() { this.html((err, str) => {
						expect(str.indexOf('blah</body>')).to.be.greaterThan(0);
						str = str.replace('blah</body>', '</body>');
						expect(str).to.be(doc);
						setTimeout(() => {
							server.close();
							done();
						}, 100);
					});});
			});
		});
	});

	it("should emit ready, load, idle events", (done) => {
		const doc = '<html><head><script>\
		document.writeln("<meta name=\'test\'></meta>");\
		</script><script type="text/javascript" src="test.js"></script>\
		<script src="test.js"></script></head>\
		<body onload="document.body.appendChild(document.createTextNode(\'toto\'))">\
		<script type="text/javascript">document.writeln("<p>there</p>");</script>\
		</body></html>';
		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test.js") {
				res.statusCode = 200;
				res.end('document.documentElement.className="toto";');
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			const evs = [];
			WebKit((err, w) => {
				w.preload("http://localhost:" + server.address().port, {console:true})
					.once('ready', () => {
						evs.push('ready');
					})
					.once('load', () => {
						evs.push('load');
					})
					.once('idle', () => {
						evs.push('idle');
						expect(evs.join(' ')).to.be('ready load idle');
						server.close();
						done();
					});
			});
		});
	});

	it("should preload then load and wait idle", (done) => {
		const doc = '<html><head><script>\
		document.writeln("<meta name=\'test\'></meta>");\
		</script><script type="text/javascript" src="test.js"></script>\
		<script src="test.js"></script></head>\
		<body onload="document.body.appendChild(document.createTextNode(\'toto\'))">\
		<script type="text/javascript">document.writeln("<p>there</p>");</script>\
		</body></html>';
		const script = '<script type="text/javascript" src="test2.js"></script>';

		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test.js") {
				res.statusCode = 200;
				res.setHeader('Content-Type', "application/javascript");
				res.write('document.documentElement.setAttribute("test", "toto");');
				res.end();
			} else if (req.url == "/test2.js") {
				// never called !
				expect(false).to.be(true);
				res.statusCode = 200;
				res.setHeader('Content-Type', "application/javascript");
				res.write('document.documentElement.setAttribute("test", "tota");');
				res.end();
			} else {
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			const port = server.address().port;
			WebKit((err, w) => {
				w.preload("http://localhost:" + port, {console: true})
					.when('ready', function(cb) {
						this.html((err, str) => {
							expect(str).to.be(doc);
							w.run((it, done) => {
								const script = document.createElement('script');
								script.type = 'text/javascript';
								script.src = 'test2.js';
								document.head.appendChild(script);
								done();
							}, script, (err) => {
								w.html((err, str) => {
									expect(err).to.not.be.ok();
									expect(str.replace(script, '')).to.be(doc);
									expect(str.indexOf(script) > 0).to.be(true);
									cb();
									thenLoad(w);
								});
							});
						});
					});
			});
			function thenLoad(w) {
				w.unload((err) => {
					w.load("http://localhost:" + port, {content: doc}).once('load', () => {
						w.html((err, str) => {
							if (err) console.error(err);
							const wroteMeta = '<meta name="test">\n';
							const wroteP = '<p>there</p>\n';
							expect(str.indexOf(wroteMeta)).to.be.ok();
							expect(str.indexOf(wroteP)).to.be.ok();
							setTimeout(() => {
								server.close();
								done();
							}, 100);
						});
					});
				});
			}
		});
	});
});
