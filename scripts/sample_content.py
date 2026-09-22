"""Synthetic study content for the dev collection.

Written for this project (not copied from any commercial deck). The custom
notetype imitates the *shape* of popular medical decks (cloze + Extra field,
hint buttons, night-mode CSS) so rendering is exercised realistically.
"""

# (deck, front, back)
BASIC = [
    ("Step 1::Cardio::Pharm", "Mechanism of action of <b>digoxin</b>?",
     "Inhibits Na<sup>+</sup>/K<sup>+</sup>-ATPase → ↑ intracellular Ca<sup>2+</sup> → ↑ contractility"),
    ("Step 1::Cardio::Pharm", "Classic adverse effect of <b>ACE inhibitors</b> caused by ↑ bradykinin?",
     "Dry cough (and angioedema)"),
    ("Step 1::Cardio::Pharm", "Antidote for digoxin toxicity?", "Digoxin immune Fab (+ correct K<sup>+</sup> and Mg<sup>2+</sup>)"),
    ("Step 1::Cardio::Pharm", "Which antiarrhythmic causes pulmonary fibrosis, thyroid dysfunction and blue-gray skin?",
     "Amiodarone (class III)"),
    ("Step 1::Cardio::Pharm", "Drug of choice to convert PSVT?", "Adenosine"),
    ("Step 1::Cardio::Pharm", "Statins inhibit which enzyme?", "HMG-CoA reductase"),
    ("Step 1::Cardio::Pharm", "Nitrates primarily dilate ___ (arteries or veins)?", "Veins → ↓ preload"),
    ("Step 1::Cardio::Pharm", "Which β-blockers are cardioselective (β<sub>1</sub>)?", "<i>A–M</i>: atenolol, betaxolol, esmolol, metoprolol, acebutolol"),
    ("Step 1::Cardio::Physiology", "Which heart sound is associated with a stiff, hypertrophic ventricle?", "S4 (atrial kick against a stiff ventricle)"),
    ("Step 1::Cardio::Physiology", "Normal cardiac output formula?", "CO = SV × HR"),
    ("Step 1::Cardio::Physiology", "Phase 0 of the ventricular action potential is caused by?", "Rapid Na<sup>+</sup> influx through voltage-gated channels"),
    ("Step 1::Cardio::Physiology", "What does the <b>a wave</b> of the JVP represent?", "Atrial contraction"),
    ("Step 1::Cardio::Physiology", "Frank–Starling law in one sentence?", "↑ end-diastolic volume → ↑ force of contraction (to a point)"),
    ("Step 1::Cardio::Pathology", "ECG: irregularly irregular rhythm with no discrete P waves?",
     'Atrial fibrillation<br><img src="ecg_afib.svg">'),
    ("Step 1::Cardio::Pathology", "Most common cause of death in the first hours after MI?", "Ventricular arrhythmia"),
    ("Step 1::Cardio::Pathology", "Listen: which extra heart sound is this?",
     "S3 gallop — early diastolic, volume overload (e.g. HF, dilated CM)[sound:s3_gallop.wav]"),
    ("Step 1::Cardio::Pathology", "Tetralogy of Fallot — four features?", "Pulmonary stenosis, RVH, overriding aorta, VSD"),
    ("Step 1::Cardio::Pathology", "Boot-shaped heart on CXR?", "Tetralogy of Fallot (RVH)"),
    ("Step 1::Renal::Physiology", "Where is most filtered Na<sup>+</sup> reabsorbed?", 'Proximal convoluted tubule (~65%)<br><img src="nephron.svg">'),
    ("Step 1::Renal::Physiology", "GFR is best estimated clinically by clearance of?", "Creatinine (inulin is the gold standard)"),
    ("Step 1::Renal::Physiology", "Effect of angiotensin II on the efferent arteriole?", "Constriction → ↑ GFR, ↑ FF"),
    ("Step 1::Renal::Physiology", "Where does ADH act?", "Collecting duct principal cells (V2 → aquaporin-2 insertion)"),
    ("Step 1::Renal::Pharm", "Site and mechanism of <b>furosemide</b>?", "Thick ascending limb; inhibits Na<sup>+</sup>/K<sup>+</sup>/2Cl<sup>−</sup> cotransporter"),
    ("Step 1::Renal::Pharm", "Thiazides cause hyper- or hypo-calcemia?", "Hyper­calcemia (↑ Ca<sup>2+</sup> reabsorption in DCT)"),
    ("Step 1::Renal::Pharm", "K<sup>+</sup>-sparing diuretic that is also an aldosterone receptor antagonist?", "Spironolactone (also eplerenone)"),
    ("Step 1::Renal::Pharm", "Acetazolamide inhibits?", "Carbonic anhydrase (PCT) → HCO<sub>3</sub><sup>−</sup> diuresis"),
    ("Step 1::Micro::Bacteria", "Gram-positive cocci in clusters, catalase +, coagulase +?",
     '<i>Staphylococcus aureus</i><br><img src="gram_stain_clusters.svg">'),
    ("Step 1::Micro::Bacteria", "Virulence factor of <i>S. aureus</i> that binds Fc of IgG?", "Protein A"),
    ("Step 1::Micro::Bacteria", "Currant-jelly sputum in an alcoholic?", "<i>Klebsiella pneumoniae</i>"),
    ("Step 1::Micro::Bacteria", "Rice-water diarrhea?", "<i>Vibrio cholerae</i> (cholera toxin ↑ cAMP)"),
    ("Step 1::Micro::Bacteria", "Bacterium that causes pseudomembranous colitis after antibiotics?", "<i>Clostridioides difficile</i>"),
    ("Step 1::Micro::Viruses", "Owl's-eye intranuclear inclusions?", "Cytomegalovirus"),
    ("Step 1::Micro::Viruses", "Koplik spots are pathognomonic for?", "Measles (rubeola)"),
    ("Step 1::Micro::Viruses", "HIV: which protein binds CD4?", "gp120"),
    ("Step 1::Biochem::Metabolism", "Rate-limiting enzyme of glycolysis?", "Phosphofructokinase-1 (PFK-1)"),
    ("Step 1::Biochem::Metabolism", "Rate-limiting enzyme of the urea cycle?", "Carbamoyl phosphate synthetase I"),
    ("Step 1::Biochem::Metabolism", "Vitamin cofactor for pyruvate dehydrogenase that's deficient in alcoholics?", "Thiamine (B1)"),
    ("Step 1::Biochem::Metabolism", "Von Gierke disease: deficient enzyme?", "Glucose-6-phosphatase"),
    ("Step 1::Neuro::Anatomy", "Lesion causing contralateral homonymous hemianopia with macular sparing?", "PCA infarct (occipital cortex)"),
    ("Step 1::Neuro::Anatomy", "Which nerve innervates the lateral rectus?", "CN VI (abducens)"),
    ("Step 1::Neuro::Anatomy", "Broca aphasia — lesion location?", "Inferior frontal gyrus, dominant hemisphere"),
    ("Step 2 CK::Internal Medicine", "First-line therapy for uncomplicated hypertension (non-Black, no CKD)?", "Thiazide, ACEi/ARB or CCB"),
    ("Step 2 CK::Internal Medicine", "Initial test for suspected pulmonary embolism with low pretest probability?", "D-dimer"),
    ("Step 2 CK::Internal Medicine", "Target HbA1c for most adults with diabetes?", "< 7%"),
    ("Step 2 CK::Internal Medicine", "Next step: STEMI presenting 1 hour after onset at a PCI-capable hospital?", "Primary PCI (door-to-balloon ≤ 90 min)"),
    ("Step 2 CK::Pediatrics", "Most common cause of bronchiolitis?", "RSV"),
    ("Step 2 CK::Pediatrics", "Steeple sign on neck X-ray?", "Croup (parainfluenza virus)"),
    ("Step 2 CK::Pediatrics", "Age by which a child should walk independently?", "≈ 12–15 months (evaluate if not by 18 months)"),
]

# (deck, front, back) for Anki's stock "Basic (type in the answer)"
TYPED = [
    ("Step 1::Cardio::Pharm", "Antidote for acetaminophen overdose?", "N-acetylcysteine"),
    ("Step 1::Micro::Bacteria", "Drug of choice for syphilis?", "Penicillin G"),
    ("Step 1::Biochem::Metabolism", "Vitamin deficiency causing pellagra?", "Niacin"),
]

# (deck, text, extra) for the custom "Med Cloze (sample)" notetype
CLOZE = [
    ("Step 1::Cardio::Pharm",
     "{{c1::Metoprolol}} is a {{c2::β<sub>1</sub>-selective}} blocker used after MI to ↓ mortality.",
     "Avoid abrupt withdrawal → rebound tachycardia."),
    ("Step 1::Cardio::Pharm",
     "Hydralazine + {{c1::nitrates}} improve survival in {{c2::HFrEF}}, especially in Black patients.",
     "Hydralazine can cause drug-induced lupus."),
    ("Step 1::Cardio::Pharm",
     "Class IC antiarrhythmics (e.g. {{c1::flecainide}}) are contraindicated in {{c2::structural heart disease}}.",
     "CAST trial: ↑ mortality post-MI."),
    ("Step 1::Cardio::Pharm",
     "Heparin monitoring uses {{c1::aPTT}}; warfarin uses {{c2::PT/INR}}.",
     "Mnemonic: <b>W</b>ar <b>E</b>x<b>T</b>, <b>H</b>eP<b>I</b>n<b>T</b>in"),
    ("Step 1::Cardio::Physiology",
     "Preload is approximated by {{c1::end-diastolic volume}}; afterload by {{c2::mean arterial pressure}}.",
     ""),
    ("Step 1::Cardio::Physiology",
     "The {{c1::SA node}} is the primary pacemaker because it has the {{c2::fastest rate of phase 4 depolarization}}.",
     "Phase 4 is driven by the funny current (I<sub>f</sub>)."),
    ("Step 1::Cardio::Physiology",
     "Coronary blood flow to the LV peaks during {{c1::diastole}}.",
     '<img src="heart_diagram.svg">'),
    ("Step 1::Cardio::Pathology",
     "Most common valvular lesion in rheumatic heart disease: {{c1::mitral stenosis}}.",
     "Aschoff bodies, anti-streptolysin O titers."),
    ("Step 1::Cardio::Pathology",
     "Kussmaul sign (↑ JVP on inspiration) suggests {{c1::constrictive pericarditis}}.",
     "Also seen in restrictive cardiomyopathy, RV infarct."),
    ("Step 1::Cardio::Pathology",
     "Pulsus paradoxus is a drop in systolic BP > {{c1::10 mmHg}} on inspiration, seen in {{c2::cardiac tamponade}}.",
     "Beck triad: hypotension, distended neck veins, muffled heart sounds."),
    ("Step 1::Renal::Physiology",
     "Filtration fraction = {{c1::GFR}} / {{c2::RPF}}, normally about {{c3::20%}}.",
     ""),
    ("Step 1::Renal::Physiology",
     "Renin is secreted by {{c1::juxtaglomerular}} cells in response to ↓ renal perfusion.",
     '<img src="nephron.svg">'),
    ("Step 1::Renal::Pharm",
     "Loop diuretics cause {{c1::hypo}}calcemia; thiazides cause {{c2::hyper}}calcemia.",
     "Loops lose calcium."),
    ("Step 1::Micro::Bacteria",
     "<i>Streptococcus pyogenes</i> is {{c1::β-hemolytic}} and {{c2::bacitracin-sensitive}}.",
     "Group B strep is bacitracin-resistant."),
    ("Step 1::Micro::Bacteria",
     "The most common cause of community-acquired pneumonia is {{c1::<i>Streptococcus pneumoniae</i>}}.",
     "Lancet-shaped gram-positive diplococci."),
    ("Step 1::Micro::Bacteria",
     "<i>Neisseria meningitidis</i> ferments {{c1::maltose}} and {{c2::glucose}}; <i>N. gonorrhoeae</i> only {{c2::glucose}}.",
     ""),
    ("Step 1::Micro::Viruses",
     "Hepatitis {{c1::B}} is the only hepatitis virus with a DNA genome.",
     "Hepadnavirus; partially double-stranded circular DNA."),
    ("Step 1::Micro::Viruses",
     "EBV infects B cells via {{c1::CD21}}.",
     "Heterophile antibody (Monospot) positive."),
    ("Step 1::Biochem::Metabolism",
     "{{c1::Insulin}} activates PFK-2 → ↑ fructose-2,6-bisphosphate → ↑ {{c2::glycolysis}}.",
     ""),
    ("Step 1::Biochem::Metabolism",
     "Lesch–Nyhan syndrome is caused by deficiency of {{c1::HGPRT}}.",
     "Self-mutilation, hyperuricemia, gout."),
    ("Step 1::Neuro::Anatomy",
     "The {{c1::internal capsule}} is supplied by the {{c2::lenticulostriate}} arteries.",
     "Lacunar infarcts → pure motor stroke."),
    ("Step 2 CK::Internal Medicine",
     "CHA<sub>2</sub>DS<sub>2</sub>-VASc ≥ {{c1::2}} in men indicates anticoagulation for AF.",
     '<img src="ecg_afib.svg">'),
    ("Step 2 CK::Internal Medicine",
     "First-line treatment for anaphylaxis is {{c1::IM epinephrine}}.",
     "0.3–0.5 mg of 1 mg/mL into the anterolateral thigh."),
    ("Step 2 CK::Pediatrics",
     "Kawasaki disease is treated with {{c1::IVIG}} and {{c2::aspirin}}.",
     "CRASH and burn: Conjunctivitis, Rash, Adenopathy, Strawberry tongue, Hands/feet + fever ≥ 5 days."),
]

MED_CLOZE_FRONT = """<div class="deck-crumbs">{{Deck}}</div>
<div class="text">{{cloze:Text}}</div>
{{#Extra}}<div class="hint-row"><button class="hint-btn" type="button" data-target="extra-q">Extra</button></div>
<div id="extra-q" class="hint" hidden>{{Extra}}</div>{{/Extra}}
<script>
  // Hint buttons, like the ones popular medical decks ship.
  document.querySelectorAll('.hint-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var el = document.getElementById(btn.dataset.target);
      if (!el) return;
      el.hidden = !el.hidden;
      btn.classList.toggle('open', !el.hidden);
    });
  });
</script>"""

MED_CLOZE_BACK = """<div class="deck-crumbs">{{Deck}}</div>
<div class="text">{{cloze:Text}}</div>
{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}
{{#Source}}<div class="hint-row"><button class="hint-btn" type="button" data-target="source-a">Source</button></div>
<div id="source-a" class="hint" hidden>{{Source}}</div>{{/Source}}
<script>
  document.querySelectorAll('.hint-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var el = document.getElementById(btn.dataset.target);
      if (!el) return;
      el.hidden = !el.hidden;
      btn.classList.toggle('open', !el.hidden);
    });
  });
</script>"""

MED_CLOZE_CSS = """.card {
  font-family: Georgia, "Iowan Old Style", serif;
  font-size: 22px;
  line-height: 1.55;
  text-align: center;
  color: #1c2330;
  background-color: #fbfaf7;
}
.deck-crumbs { font: 12px/1.4 -apple-system, system-ui, sans-serif; color: #8a8f98; letter-spacing: .02em; margin-bottom: 1.2em; }
.text { max-width: 36em; margin: 0 auto; }
.cloze { font-weight: 700; color: #1d4ed8; }
.extra { margin-top: 1.4em; padding-top: 1em; border-top: 1px solid #e6e2d8; font-size: .82em; color: #505866; }
.hint-row { margin-top: 1.2em; }
.hint-btn { font: 600 13px -apple-system, system-ui, sans-serif; padding: 6px 14px; border-radius: 999px; border: 1px solid #c9ccd3; background: transparent; color: #505866; cursor: pointer; }
.hint-btn.open { background: #1d4ed8; border-color: #1d4ed8; color: white; }
.hint { margin-top: .8em; font-size: .82em; color: #505866; }
img { max-width: 100%; border-radius: 8px; }

/* Night mode: Anki sets .nightMode / .night_mode on <body> */
.nightMode.card, .night_mode.card { color: #e6e8ec; background-color: #1b1d22; }
.nightMode .cloze { color: #7aa2ff; }
.nightMode .extra { border-top-color: #33363d; color: #a4a9b3; }
.nightMode .hint, .nightMode .deck-crumbs { color: #a4a9b3; }
.nightMode .hint-btn { border-color: #444851; color: #c3c7cf; }
.nightMode .hint-btn.open { background: #7aa2ff; border-color: #7aa2ff; color: #111; }
.nightMode img { filter: brightness(.9); }
"""

BASIC_CSS_ADDITION = """
img { max-width: 100%; height: auto; margin-top: .6em; }
.nightMode img { filter: invert(.88) hue-rotate(180deg); }
"""
