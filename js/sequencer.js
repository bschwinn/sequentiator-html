/*
 * ~~~~~~~ Sequentiator ~~~~~~~
 * 
 * Combination sequencer and arpeggiator.  2 Analog outputs.
 * - Analog output 1 can be either bank1 or arpeggiator
 * - Analog output 2 is always bank2
 *
 */

// data model helpers
populateSteps = function(len, alt) {
	var steps = [];
	for ( var i=0; i<len; i++ ) {
		var val = ( alt ) ?  256*(len-i) :  256*i;
		steps[steps.length] = { idx: i, enabled: true, val: val }
	}
	return steps;
}
populateArpSteps = function(len) {
	var steps = [];
	for ( var i=0; i<len; i++ ) {
		var val = i % 12;
		steps[steps.length] = { idx: i, enabled: true, val: val }
	}
	return steps;
}
// number of steps, reset can be less
var numberOfSteps = 16;
var resets = new Array(numberOfSteps);
resets[numberOfSteps-1] = true;
// sequencer has two fully variable banks and one arpeggiator bank
var BANK_1 = 1;
var BANK_2 = 2;
var selectedBank = BANK_1;
var stepsBank1 = populateSteps(numberOfSteps, false);
var stepsBank2 = populateSteps(numberOfSteps, true);
var arpSteps = populateArpSteps(numberOfSteps, false);
// master output CV offset and BPM
var masterOutput = 127;
var masterSpeed = 127;
// output mode selector - arpegiator vs. standard sequencer
var MODE_SEQ = 0;
var MODE_ARP = 1;
var OUT_1 = 1;
var OUT_2 = 2;
var selectedMode = MODE_SEQ;
// sequencer states
var STATE_PLAYING = 1;
var STATE_STOPPED = 2;
var STATE_PAUSED = 3;
var sequencerState = STATE_STOPPED;
var currentStep = 0;
// to reference all the sliders
var stepUIObjects = [];
var arpStepUIObjects = [];
// sequencer speed
var SPEED_MULT_HALF = 0.5;
var SPEED_MULT_1X = 1;
var SPEED_MULT_2X = 2;
var multiplier = SPEED_MULT_1X;
// received from container/uController
var bpm = 0;

// initialize container
var seqConf = { maxSteps: numberOfSteps, speed: masterSpeed, multiplier: 1, range: 200, offset: 50 };
var seqCont = new sequencerContainer(seqConf);
seqCont.addHandler( function(data) {
	if ( data.step != null ) {
		updateCurrentStep(data.step);
	}
	if ( data.bpm != null ) {
		updateBPM(data.bpm);
	}
	if ( data.version != null ) {
		updateVersion(data.version);
	}
});

// global function for container to register itself
// iOS needs a wrapper, OSX injects an implementation
window.__registerContainer = function(os) {
    if ( os == 'iOS' ) {
        seqCont.wireContainer( new iOSContainer(), seqConf );
    } else if ( os == 'OSX' ) {
        seqCont.wireContainer( window.__container, seqConf );
    } else if ( os == 'fake' ) {
        seqCont.wireContainer( new fakeContainer(), seqConf );
    } else {
        console.log("Error: unrecognized container OS.");
        return;
    }
}


// start/stop/pause the sequencer
seqStart = function() {
	sequencerState = STATE_PLAYING;
	seqCont.start();
	updateTransportButtons();
}
seqStop = function() {
	sequencerState = STATE_STOPPED;
	seqCont.stop();
	updateTransportButtons();
}
seqPause = function() {
	sequencerState = STATE_PAUSED;
	seqCont.pause();
	updateTransportButtons();
}
// advance the sequencer one step (while paused)
seqNext = function() {
	seqCont.next();
}
// backup the sequencer one step (while paused)
seqPrev = function() {
	seqCont.prev();
}
// reset the sequencer to zero
seqReset = function() {
	seqCont.reset();
}
// reset the sequencer to zero
seqTap = function() {
	console.log("Tap tempo hit");
}

// speed slider handling
handleSpeedSlider = function(values, handle, unencoded) {
	masterSpeed = values[handle];
	seqCont.sendData( { speed: masterSpeed } );
}
// output voltage slider handling
handleOutputSlider = function(values, handle, unencoded) {
	masterOutput = values[handle];
	seqCont.sendData( { level: masterOutput } );
}
// enable/diable a single step
handleStepToggle = function(idx, enabled) {
	var steps = ( selectedBank == BANK_1 ) ? stepsBank1 : stepsBank2;
	steps[idx].enabled = enabled;
	seqCont.sendData( { output: (( selectedBank == BANK_1 ) ? OUT_1 : OUT_2), step: idx, enabled: enabled } );
}
handleArpStepToggle = function(idx, enabled) {
	arpSteps[idx].enabled = enabled;
	seqCont.sendData( { output: OUT_1, step: idx, enabled: enabled } ); // Bank/Output is locked at 1 for arp
}
// set the value (CV) for a step
handleStepSlider = function(idx, val) {
	var steps = ( selectedBank == BANK_1 ) ? stepsBank1 : stepsBank2;
	steps[idx].val = val;
	seqCont.sendData( { output: (( selectedBank == BANK_1 ) ? OUT_1 : OUT_2), step: idx, val: val } );
}
handleArpStepSlider = function(idx, val) {
	arpSteps[idx].val = val;
	seqCont.sendData( { output: OUT_1, step: idx, val: val } );  // Bank/Output is locked at 1 for arp
}
// pass the lowest reset up to the sequencer
handleStepReset = function(idx, val) {
	resets[idx] = val;
	var anyResets = false;
	for ( var i=0; i<resets.length; i++ ) {
		if ( !anyResets ) {
			$('#step_'+i+' .seqStep').removeClass('disabled');
			$('#arpstep_'+i+' .seqStep').removeClass('disabled');
		} else {
			$('#step_'+i+' .seqStep').addClass('disabled');
			$('#arpstep_'+i+' .seqStep').addClass('disabled');
		}
		if ( resets[i] && !anyResets) {
			seqCont.sendData( { reset: i+1 } );
			anyResets = true;
		}
	}
	if ( !anyResets ) seqCont.sendData( { reset: numberOfSteps } );
}
// set the speed multiplier
setMultiplier = function(mult) {
	multiplier = mult;
	seqCont.sendData( { multiplier: mult } );
	updateSpeedButtons();
}
// select the sequencer bank
setBank = function(bank) {
	selectedBank = bank;
	updateStepValues();
	updateStepDisplay();
	updateBankButtons();
}
setMode = function(mode) {
	function getAllStepData(arr) {
		var ret = [];
		for(var i=0; i<arr.length; i++) {
			var thing = { output: OUT_1, step: i, val: arr[i].val, enabled: arr[i].enabled };
			ret[ret.length] = thing;
		}
		return ret;
	}
	selectedMode = mode;
	seqCont.sendData( { output: OUT_1, mode: (mode==MODE_ARP) ? "arp" : "seq" } );
	seqCont.sendBatch( getAllStepData((mode==MODE_ARP) ? arpSteps : stepsBank1));
	updateStepValues();
	updateStepDisplay();
	updateSelectedMode();
}
// bpm data handler (from the sequencer)
updateBPM = function(bpm) {
	$('#seqBPM').text(bpm.toFixed(1));
}
// update step values/toggles (useful for changing banks)
updateStepValues = function() {
	if ( selectedMode == MODE_ARP && selectedBank == BANK_1) {
		for ( var i=0;i<numberOfSteps;i++ ) {
			arpStepUIObjects[i].update(arpSteps[i].enabled, arpSteps[i].val, resets[i]);
		}
	} else {
		var steps = ( selectedBank == BANK_1 ) ? stepsBank1 : stepsBank2;
		for ( var i=0;i<numberOfSteps;i++ ) {
			stepUIObjects[i].update(steps[i].enabled, steps[i].val, resets[i]);
		}
	}
}
// update step values/toggles (useful for changing banks)
updateStepDisplay = function() {
	if ( selectedMode == MODE_ARP ) {
		if ( selectedBank == BANK_2 ) {
			$('#sequenceRow1').show();
			$('#sequenceRow2').show();
			$('#arpRow1').hide();
			$('#arpRow2').hide();
		} else {
			$('#sequenceRow1').hide();
			$('#sequenceRow2').hide();
			$('#arpRow1').show();
			$('#arpRow2').show();
		}
	} else {
		$('#sequenceRow1').show();
		$('#sequenceRow2').show();
		$('#arpRow1').hide();
		$('#arpRow2').hide();
	}
}
// update the version number from the container
updateVersion = function(ver) {
	$('#sequencerVersion').text(ver);
}
// current step handler (from the sequencer)
updateCurrentStep = function(currStep) {
	for ( var i=0;i<numberOfSteps;i++ ) {
		stepUIObjects[i].resetCurrent();
		arpStepUIObjects[i].resetCurrent();
	}
	stepUIObjects[currStep].setCurrent();
	arpStepUIObjects[currStep].setCurrent();
}
// update the transport button states
updateTransportButtons = function(){
	if (sequencerState == STATE_PAUSED) {
		$('#seqPause').removeClass('btn-default').addClass('btn-warning');
		$('#seqPrev').removeClass('btn-default').addClass('btn-primary');
		$('#seqNext').removeClass('btn-default').addClass('btn-primary');
		$('#seqPlay').removeClass('btn-warning').addClass('btn-default');
		$('#seqStop').removeClass('btn-warning').addClass('btn-default');
	} else if (sequencerState == STATE_PLAYING) {
		$('#seqPlay').removeClass('btn-default').addClass('btn-warning');
		$('#seqStop').removeClass('btn-warning').addClass('btn-default');
		$('#seqPause').removeClass('btn-warning').addClass('btn-default');
		$('#seqPrev').removeClass('btn-primary').addClass('btn-default');
		$('#seqNext').removeClass('btn-primary').addClass('btn-default');
	} else {
		$('#seqStop').removeClass('btn-default').addClass('btn-warning');
		$('#seqPause').addClass('btn-default').removeClass('btn-warning');
		$('#seqPrev').addClass('btn-default').removeClass('btn-primary');
		$('#seqNext').addClass('btn-default').removeClass('btn-primary');
		$('#seqPlay').addClass('btn-default').removeClass('btn-warning');
	}
}
// update the speed mult button states
updateSpeedButtons = function(){
	if (multiplier == SPEED_MULT_HALF) {
		$('#seqSpeedHalf').addClass('btn-warning').removeClass('btn-default');
		$('#seqSpeed1X').removeClass('btn-warning').addClass('btn-default');
		$('#seqSpeed2X').removeClass('btn-warning').addClass('btn-default');
	} else if (multiplier == SPEED_MULT_2X) {
		$('#seqSpeedHalf').removeClass('btn-warning').addClass('btn-default');
		$('#seqSpeed1X').removeClass('btn-warning').addClass('btn-default');
		$('#seqSpeed2X').addClass('btn-warning').removeClass('btn-default');
	} else {
		$('#seqSpeedHalf').removeClass('btn-warning').addClass('btn-default');
		$('#seqSpeed1X').addClass('btn-warning').removeClass('btn-default');
		$('#seqSpeed2X').removeClass('btn-warning').addClass('btn-default');
	}
}
// update the bank button states
updateBankButtons = function(){
	if (selectedBank == BANK_1) {
		$('#bank1Selector').removeClass('btn-default').addClass('btn-warning');
		$('#bank2Selector').removeClass('btn-warning').addClass('btn-default');
	} else { // BANK_2
		$('#bank1Selector').removeClass('btn-warning').addClass('btn-default');
		$('#bank2Selector').removeClass('btn-default').addClass('btn-warning');
	}
}
// update the selected output (sequencer or arpeggiator)
updateSelectedMode = function() {
	if (selectedMode == MODE_ARP) {
		$('#arpModeSelector').removeClass('btn-default').addClass('btn-warning');
		$('#seqModeSelector').removeClass('btn-warning').addClass('btn-default');
		$('#bank1Selector').text("Arp");
	} else {
		$('#arpModeSelector').removeClass('btn-warning').addClass('btn-default');
		$('#seqModeSelector').removeClass('btn-default').addClass('btn-warning');
		$('#bank1Selector').html("&#160;&#160;1&#160;&#160;");
	}
}
// initialize/create the transport buttons
initTransportButtons = function(){
	$('#seqStop').click(function() {
		seqStop();
	});
	$('#seqPlay').click(function() {
		seqStart();
	});
	$('#seqPause').click(function() {
		seqPause();
	});
	$('#seqReset').click(function() {
		seqReset();
	});
	$('#seqPrev').click(function() {
		seqPrev();
	});
	$('#seqNext').click(function() {
		seqNext();
	});
}
// initialize/create the speed sliders and buttons
initSpeedSlider = function(){
	var slider = $('#speedSlider')[0];
	noUiSlider.create(slider, {
		start: 2047,
		orientation: "vertical",
		direction: 'rtl',
		range: {
			'min': 0,
			'max': 4095
		},
		pips: {
			mode: 'positions',
			values: [0,50,100],
			density: 4
		}
	});
	slider.noUiSlider.on('slide', handleSpeedSlider);
}
initSpeedButtons = function(){
	$('#seqSpeedHalf').click(function() {
		setMultiplier(SPEED_MULT_HALF);
	});
	$('#seqSpeed1X').click(function() {
		setMultiplier(SPEED_MULT_1X);
	});
	$('#seqSpeed2X').click(function() {
		setMultiplier(SPEED_MULT_2X);
	});
	$('#seqSpeedTap').click(function() {
		seqTap();
	});
}
initBankButtons = function() {
	$('#bank1Selector').click(function() {
		setBank(BANK_1);
	});
	$('#bank2Selector').click(function() {
		setBank(BANK_2);
	});
}
initModeButtons = function() {
	$('#arpModeSelector').click(function() {
		setMode(MODE_ARP);
	});
	$('#seqModeSelector').click(function() {
		setMode(MODE_SEQ);
	});
}
// initialize/create the ouput sliders and buttons
initOutputSlider = function(){
	var slider = $('#outputSlider')[0];
	noUiSlider.create(slider, {
		start: 2047,
		orientation: "vertical",
		direction: 'rtl',
		range: {
			'min': 0,
			'max': 4095
		},
		pips: {
			mode: 'positions',
			values: [0,50,100],
			density: 4
		}
	});
	slider.noUiSlider.on('slide', handleOutputSlider);
}

initMasterSection = function() {
	// seq/arp mode selector buttons
	initModeButtons();
	updateSelectedMode();
	// speed controls
	initSpeedButtons();
	initSpeedSlider();
	updateSpeedButtons();
	// bank selector buttons
	initBankButtons();
	updateBankButtons();

	// master transport
	initTransportButtons();
	updateTransportButtons();

	// output voltage and bank control
	// initOutputSlider();
}

initStep = function(parentSel, step) {
	var stepObj = new sequencerStep( { idpref: 'step_', parentSelector: parentSel, stepIndex : step.idx, val: step.val, enabled: step.enabled, reset: resets[step.idx] } );
	stepObj.addHandlers(handleStepToggle, handleStepSlider, handleStepReset);
	if ( currentStep == step.idx ) {
		stepObj.setCurrent();
	}
	stepUIObjects[stepUIObjects.length] = stepObj;
}
initSteps = function() {
	// starndard sequencer steps
	var steps = ( selectedBank == BANK_1 ) ? stepsBank1 : stepsBank2;
	for ( var i=0; i<numberOfSteps; i++) {
		initStep( (i < (numberOfSteps/2)) ? '#sequenceRow1' : '#sequenceRow2', steps[i] );
	}
	// arpeggiator steps - Analog output 1 can be either bank1 or arpeggiator
	for ( var i=0; i<numberOfSteps; i++) {
		initArpStep( (i < (numberOfSteps/2)) ? '#arpRow1' : '#arpRow2', arpSteps[i] );
	}
	updateStepValues();
	updateStepDisplay();
}
initArpStep = function(parentSel, step) {
	var stepObj = new arpStep( { idpref: 'arpstep_', parentSelector: parentSel, stepIndex : step.idx, val: step.val, enabled: step.enabled, reset: resets[step.idx] } );
	stepObj.addHandlers(handleArpStepToggle, handleArpStepSlider, handleStepReset);
	if ( currentStep == step.idx ) {
		stepObj.setCurrent();
	}
	arpStepUIObjects[arpStepUIObjects.length] = stepObj;
}

$(document).ready(function(){

	initSteps();
	initMasterSection();
	$('#seqBPM').text('##.#');

	// testing out some container stuff
	window.setTimeout(function() {
		if ( !seqCont.hasContainer() ) {
			window.__registerContainer('fake');
		}
	},3000);

});


