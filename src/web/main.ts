// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { connect } from './lib/api.ts';

connect();
mount(App, { target: document.getElementById('app')! });
