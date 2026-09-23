#!/usr/bin/env node
// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import { register } from 'tsx/esm/api';

register();
await import('../src/gateway/main.ts');
