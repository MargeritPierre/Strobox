#include <Audio.h>
#include <Wire.h>
#include <SPI.h>
#include <SerialFlash.h>

// GUItool: begin automatically generated code
AudioInputUSB            USBAudioInput;           //xy=267.19998931884766,200.19999599456787
AudioAmplifier           ampSignal;
AudioAmplifier           ampPWM;
AudioConnection          patchCord10(USBAudioInput, 0, ampSignal, 0);
AudioConnection          patchCord30(USBAudioInput, 1, ampPWM, 0);
//AudioOutputMQS           MQSOutput;           //xy=540.2001266479492,246.19998455047607
//AudioConnection          patchCord1(ampSignal, 0, MQSOutput, 0);
//AudioConnection          patchCord3(ampPWM, 0, MQSOutput, 1);
AudioOutputI2S           I2SAudioBoardOutput;           //xy=570.200065612793,162.1999969482422
AudioConnection          patchCord2(ampSignal, 0, I2SAudioBoardOutput, 0);
AudioConnection          patchCord4(ampPWM, 0, I2SAudioBoardOutput, 1);
AudioControlSGTL5000     sgtl5000;     //xy=302,184
// GUItool: end automatically generated code

const int ledPin = 13;

void setup() {
  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, HIGH);   // set the LED on

  AudioMemory(12);
  sgtl5000.enable();
  sgtl5000.volume(1.0);
  sgtl5000.adcHighPassFilterDisable(); // allow DC coupling
  sgtl5000.audioProcessorDisable();

  ampSignal.gain(0.2);
  ampPWM.gain(-1.0);

}


void loop() {
  //  digitalWrite(ledPin, HIGH);   // set the LED on
  //  delay(100);                  // wait for a second
  //  digitalWrite(ledPin, LOW);    // set the LED off
  //  delay(100);                  // wait for a second


  // read the PC's volume setting
//  float vol = USBAudioInput.volume();

  // scale to a nice range (not too loud)
  // and adjust the audio shield output volume
//  if (vol > 0) {
//    // scale 0 = 1.0 range to:
//    //  0.3 = almost silent
//    //  0.8 = really loud
//    //vol = 0.3 + vol * 0.5;
//  }

  // use the scaled volume setting.  Delete this for fixed volume.
  //  sgtl5000.volume(vol);
//  ampSignal.gain(vol);

//  delay(10);

}
