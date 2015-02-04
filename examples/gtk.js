var W = require('../')
W({offscreen:false})
.load('http://granze.github.io/flip-clock/components/flip-clock/demo.html', {
	transparent: true,
	decorated: false,
	style: 'html,body {background-color:transparent !important;opacity:0.8}',
	width: 600,
	height: 200
})
.wait('load').run(function() {
	var f = document.querySelector('flip-clock');
	document.body.innerHTML = "";
	document.body.appendChild(f);
})
.wait('unload')
