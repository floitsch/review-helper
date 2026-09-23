<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { RenderToken } from '../diffutil.ts';

  let { tokens }: { tokens: RenderToken[] } = $props();

  function style(t: RenderToken): string {
    let s = '';
    if (t.l) s += `--l:${t.l};`;
    if (t.d) s += `--d:${t.d};`;
    return s;
  }
  function cls(t: RenderToken): string {
    let c = 'tok';
    if (t.f) {
      if (t.f & 1) c += ' i';
      if (t.f & 2) c += ' b';
    }
    if (t.chg) c += ' chg';
    return c;
  }
</script>

{#each tokens as t}<span class={cls(t)} style={style(t)}>{t.t}</span>{/each}
