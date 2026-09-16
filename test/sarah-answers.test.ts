// Sarah's curated answers: each common question must reach the RIGHT verified answer,
// rephrasings too, and unrelated questions must NOT get a wrong answer forced on them.
import { curatedAnswer, SARAH_ANSWERS } from "../src/lib/audio/sarahAnswers";

let passed = 0; let failed = 0;
function check(name: string, cond: boolean) { if (cond) passed++; else { failed++; console.error(`FAIL: ${name}`); } }
const id = (q: string) => curatedAnswer(q)?.id ?? null;

// the 12 questions from the live quality test
const cases: [string, string | null][] = [
  ["How do I route my X32 to my Mac over USB?", "x32-usb"],
  ["Which USB channels does the Yamaha TF send the mix on?", "tf-usb"],
  ["How do I get an aux out of my Allen & Heath SQ-5 over USB to the laptop?", "sq-qu-usb"],
  ["My Focusrite Scarlett shows no signal, what do I check?", "scarlett-no-signal"],
  ["There's a hum when I plug the laptop into the desk. How do I fix it?", "hum"],
  ["I send NDI from OBS on one computer but the other computer can't see it", "ndi-obs"],
  ["Dante Virtual Soundcard is running but PresentFlow hears nothing", "dante-silent"],
  ["Blackmagic UltraStudio gives video but no audio", "blackmagic-no-audio"],
  ["How do I stream our service to YouTube with OBS?", "youtube-obs"],
  ["Should I use the main mix or an aux for the computer feed?", "main-vs-aux"],
  ["What's phantom power and should it be on?", "phantom"],
  ["How do I set up a Behringer UMC202HD for church?", "umc-setup"],
  // rephrasings
  ["midas m32 to laptop usb", "x32-usb"],
  ["our TF1 — what channel is the main mix on usb", "tf-usb"],
  ["there's a buzzing noise from the speakers when the macbook is connected", "hum"],
  ["obs ndi output not showing up on the presentation computer", "ndi-obs"],
  ["decklink card no sound", "blackmagic-no-audio"],
  ["how to go live on facebook from obs", "facebook-obs"],
  ["should 48v be on for the interface", "phantom"],
  ["behringer wing usb routing to the computer", "wing-usb"],
  ["Qu-16 usb audio to windows laptop", "sq-qu-usb"],
  // must NOT be forced onto a wrong answer
  ["how do I change the font on my slides?", null],
  ["what time does the service start?", null],
  ["my projector is blank", null],
];
for (const [q, expected] of cases) check(`"${q}" → ${expected}`, id(q) === expected);

// answer hygiene
for (const a of SARAH_ANSWERS) {
  check(`${a.id}: no 'the reference' meta-talk`, !/the reference|the knowledge base|the context/i.test(a.answer));
  check(`${a.id}: plain length (under ~110 words)`, a.answer.split(/\s+/).length <= 110);
  check(`${a.id}: never advises removing a power earth`, !/(remove|lift|cut|tape).{0,20}(earth|ground) pin/i.test(a.answer) || /never/i.test(a.answer));
}
check("phantom answer says OFF for a desk feed", /OFF/.test(SARAH_ANSWERS.find((a) => a.id === "phantom")!.answer));
check("UMC answer has no invented 'halo'", !/halo/i.test(SARAH_ANSWERS.find((a) => a.id === "umc-setup")!.answer));
check("X32 answer states the mix lands on USB 15/16", /USB 15\/16/.test(SARAH_ANSWERS.find((a) => a.id === "x32-usb")!.answer));
check("TF answer states 33 & 34", /33 & 34/.test(SARAH_ANSWERS.find((a) => a.id === "tf-usb")!.answer));
check("SQ answer covers the Windows driver", /Windows/.test(SARAH_ANSWERS.find((a) => a.id === "sq-qu-usb")!.answer));
check("NDI answer names DistroAV + Main Output", /DistroAV/.test(SARAH_ANSWERS.find((a) => a.id === "ndi-obs")!.answer) && /Main Output/.test(SARAH_ANSWERS.find((a) => a.id === "ndi-obs")!.answer));
check("hum answer leads with the charger test", /charger/.test(SARAH_ANSWERS.find((a) => a.id === "hum")!.answer));
check("YouTube answer includes Settings → Stream + key", /Settings → Stream/.test(SARAH_ANSWERS.find((a) => a.id === "youtube-obs")!.answer) && /stream key/.test(SARAH_ANSWERS.find((a) => a.id === "youtube-obs")!.answer));

console.log(`sarah-answers: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
