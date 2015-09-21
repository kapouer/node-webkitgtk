var W = require('../')
W.load('http://granze.github.io/flip-clock/components/flip-clock/demo/', {
	offscreen: false,
	transparent: true,
	decorated: false,
	style: 'html,body {background-color:transparent !important;opacity:0.8}',
	width: 600,
	height: 200
})
.once('ready', function() {
	this.run(function() {
		var f = document.querySelector('flip-clock');
		document.body.innerHTML = "";
		document.body.appendChild(f);
	});
});

