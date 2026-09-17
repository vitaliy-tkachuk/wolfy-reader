/**
 * Named character references for the search extractor.
 *
 * The scope is HTML 4.01's three entity sets — Latin-1, symbols, special (252
 * names, read off the W3C DTDs) — plus `apos` and the all-uppercase aliases the
 * HTML table defines, each carrying the character the *current* HTML table gives
 * it (`lang`/`rang` moved to the mathematical angle brackets since HTML 4.01).
 * That is the set book markup is written against, and it is what the frame shows:
 * outside the XML five, a named entity is only declared by the XHTML DTD, so
 * `DOMParser('application/xhtml+xml')` fails on one and the frame falls back to
 * `text/html`, whose parser decodes every name it knows. Decoding the same names
 * here is therefore fidelity, not convenience — a name left verbatim both misses
 * the query and captures an anchor quoting text the frame does not contain.
 *
 * The full HTML5 table (2231 names) is an order of magnitude more bytes for names
 * books do not use; docs/domains/search.md records the measurement.
 */

/**
 * Each entry is a name immediately followed by its single character. No separator
 * is needed: every value is one non-alphanumeric code unit, so an alphanumeric run
 * is a name and the character after it is that name's value. One literal rather
 * than a map literal because the table is data, and data costs fewer bytes than
 * 260 lines of syntax.
 */
const ENCODED =
  'nbsp\u00a0iexcl¡cent¢pound£curren¤yen¥brvbar¦sect§uml¨copy©ordfªlaquo«not¬shy\u00adreg®' +
  'macr¯deg°plusmn±sup2²sup3³acute´microµpara¶middot·cedil¸sup1¹ordmºraquo»frac14¼frac12½' +
  'frac34¾iquest¿AgraveÀAacuteÁAcircÂAtildeÃAumlÄAringÅAEligÆCcedilÇEgraveÈEacuteÉEcircÊ' +
  'EumlËIgraveÌIacuteÍIcircÎIumlÏETHÐNtildeÑOgraveÒOacuteÓOcircÔOtildeÕOumlÖtimes×OslashØ' +
  'UgraveÙUacuteÚUcircÛUumlÜYacuteÝTHORNÞszligßagraveàaacuteáacircâatildeãaumläaringåaeligæ' +
  'ccedilçegraveèeacuteéecircêeumlëigraveìiacuteíicircîiumlïethðntildeñograveòoacuteóocircô' +
  'otildeõoumlödivide÷oslashøugraveùuacuteúucircûuumlüyacuteýthornþyumlÿfnofƒAlphaΑBetaΒ' +
  'GammaΓDeltaΔEpsilonΕZetaΖEtaΗThetaΘIotaΙKappaΚLambdaΛMuΜNuΝXiΞOmicronΟPiΠRhoΡSigmaΣTauΤ' +
  'UpsilonΥPhiΦChiΧPsiΨOmegaΩalphaαbetaβgammaγdeltaδepsilonεzetaζetaηthetaθiotaιkappaκ' +
  'lambdaλmuμnuνxiξomicronοpiπrhoρsigmafςsigmaσtauτupsilonυphiφchiχpsiψomegaωthetasymϑ' +
  'upsihϒpivϖbull•hellip…prime′Prime″oline‾frasl⁄weierp℘imageℑrealℜtrade™alefsymℵlarr←uarr↑' +
  'rarr→darr↓harr↔crarr↵lArr⇐uArr⇑rArr⇒dArr⇓hArr⇔forall∀part∂exist∃empty∅nabla∇isin∈notin∉' +
  'ni∋prod∏sum∑minus−lowast∗radic√prop∝infin∞ang∠and∧or∨cap∩cup∪int∫there4∴sim∼cong≅asymp≈' +
  'ne≠equiv≡le≤ge≥sub⊂sup⊃nsub⊄sube⊆supe⊇oplus⊕otimes⊗perp⊥sdot⋅lceil⌈rceil⌉lfloor⌊rfloor⌋' +
  'lang⟨rang⟩loz◊spades♠clubs♣hearts♥diams♦quot"amp&lt<gt>OEligŒoeligœScaronŠscaronšYumlŸ' +
  'circˆtilde˜ensp\u2002emsp\u2003thinsp\u2009zwnj\u200czwj\u200dlrm\u200erlm\u200fndash–' +
  'mdash—lsquo‘rsquo’sbquo‚ldquo“rdquo”bdquo„dagger†Dagger‡permil‰lsaquo‹rsaquo›euro€apos\'' +
  'AMP&COPY©GT>LT<QUOT"REG®TRADE™';

const NAMED = new Map<string, string>();
for (const [, name, character] of ENCODED.matchAll(/([A-Za-z0-9]+)([^A-Za-z0-9])/g)) {
  NAMED.set(name!, character!);
}

/**
 * Decodes numeric (`&#233;`, `&#xe9;`) and named (`&ouml;`) HTML entities. Names
 * are matched exactly, because case picks a different character (`&Ouml;` is Ö,
 * `&ouml;` is ö). An unknown name is left verbatim — a book's literal `&` in prose
 * stays `&`.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED.get(body) ?? whole;
  });
}
