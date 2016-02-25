var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

// TODO
// navigation screws page lifecycle events
//

describe("navigation", function suite() {
	it("should emit navigate event when navigation is true and allow redirection", function(done) {
		var counter = 0;
		var navcount = 0;
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 200;
			res.end("ok" + counter++);
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port, {
				navigation: true
			}, function(err, w) {
				w.run(function(done) {
					document.location = '/anotherpage';
					done();
				}, function() {
					setTimeout(function() {
						server.close();
						expect(counter).to.be(2);
						expect(navcount).to.be(1);
						done();
					}, 100);
				});
			}).on('navigate', function(url) {
				navcount++;
				expect(url).to.be(this.uri + 'anotherpage');
			});
		});
	});
	it("should emit navigate event when navigation is false and disallow redirection", function(done) {
		var counter = 0;
		var navcount = 0;
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 200;
			if (req.url == "/") {
				counter++;
				res.end(`
					<html><body>
					<script type="text/javascript" src="/delay.js"></script>
					<script type="text/javascript">
					document.location = "/anotherpage";
					</script>
					</body></html>
				`);
			} else if (req.url == "/anotherpage") {
				counter++;
				res.end("ok" + counter++);
			} else if (req.url == "/delay.js") {
				setTimeout(function() {
					res.end("console.log('delayed');");
				}, 500);
			}
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port, {
				navigation: false
			}).on('navigate', function(url) {
				navcount++;
				expect(url).to.be(this.uri + 'anotherpage');
			}).when('idle', function(cb) {
				expect(counter).to.be(1);
				expect(navcount).to.be(1);
				cb();
				server.close();
				done();
			});
		});
	});
});
