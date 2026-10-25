import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { pack, exportComponent } from '../src/pack.js';

const BIN = path.resolve('bin/sf-lwc.js');

test('roundtrip test: newly exported spike-demo-component can be installed and removed cleanly', async () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-lwc-project-'));
    const tmpRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-lwc-registry-'));

    try {
        // 1. Export spikeDemoComponent from devOrg into temporary registry
        const destDir = path.join(tmpRegistry, 'components', 'spike-demo-component');
        await exportComponent('spikeDemoComponent', {
            targetOrg: 'devOrg',
            projectRoot: 'c:\\Users\\tsiri\\Projects\\custom-lwc',
            registryName: 'spike-demo-component',
            destDir
        });

        assert.ok(fs.existsSync(path.join(destDir, 'manifest.json')), 'manifest.json was created');
        const manifest = JSON.parse(fs.readFileSync(path.join(destDir, 'manifest.json'), 'utf-8'));
        assert.equal(manifest.name, 'spike-demo-component');
        assert.equal(manifest.labels.length, 1);
        assert.equal(manifest.labels[0].fullName, 'Spike_Greeting_Banner');
        assert.equal(manifest.labels[0].value, 'Welcome to the Dependency Spike Demo');

        // 2. Setup consumer SFDX project
        fs.writeFileSync(path.join(tmpProject, 'sfdx-project.json'), JSON.stringify({
            packageDirectories: [{ path: 'force-app', default: true }],
            sourceApiVersion: '62.0'
        }, null, 2));
        fs.mkdirSync(path.join(tmpProject, 'force-app', 'main', 'default'), { recursive: true });

        // 3. Initialize project with the temporary registry
        execSync(`node "${BIN}" init --from "${tmpRegistry}"`, { cwd: tmpProject, stdio: 'pipe' });

        // 4. Add exported component
        execSync(`node "${BIN}" add spike-demo-component`, { cwd: tmpProject, stdio: 'pipe' });

        // Verify files installed
        const targetDefault = path.join(tmpProject, 'force-app', 'main', 'default');
        assert.ok(fs.existsSync(path.join(targetDefault, 'lwc', 'spikeDemoComponent', 'spikeDemoComponent.js')), 'LWC JS installed');
        assert.ok(fs.existsSync(path.join(targetDefault, 'classes', 'SpikeDemoController.cls')), 'Apex Controller installed');
        assert.ok(fs.existsSync(path.join(targetDefault, 'classes', 'SpikeDemoHelper.cls')), 'Transitive Apex Helper installed');

        // Verify labels merged
        const labelsFile = path.join(targetDefault, 'labels', 'CustomLabels.labels-meta.xml');
        assert.ok(fs.existsSync(labelsFile), 'CustomLabels file created');
        const labelsContent = fs.readFileSync(labelsFile, 'utf-8');
        assert.match(labelsContent, /<fullName>Spike_Greeting_Banner<\/fullName>/, 'Label fullName merged');
        assert.match(labelsContent, /<value>Welcome to the Dependency Spike Demo<\/value>/, 'Label value merged');

        // Verify lockfile
        const lock = JSON.parse(fs.readFileSync(path.join(tmpProject, 'sf-lwc.lock.json'), 'utf-8'));
        assert.ok(lock.components['spike-demo-component'], 'Component tracked in lockfile');

        // 5. Remove component
        execSync(`node "${BIN}" remove spike-demo-component`, { cwd: tmpProject, stdio: 'pipe' });

        // Verify cleanup
        assert.ok(!fs.existsSync(path.join(targetDefault, 'lwc', 'spikeDemoComponent', 'spikeDemoComponent.js')), 'LWC JS removed');
        assert.ok(!fs.existsSync(path.join(targetDefault, 'classes', 'SpikeDemoController.cls')), 'Apex Controller removed');
        assert.ok(!fs.existsSync(path.join(targetDefault, 'classes', 'SpikeDemoHelper.cls')), 'Apex Helper removed');

        const labelsAfter = fs.readFileSync(labelsFile, 'utf-8');
        assert.doesNotMatch(labelsAfter, /<fullName>Spike_Greeting_Banner<\/fullName>/, 'Label pruned from CustomLabels');
        assert.ok(!fs.existsSync(path.join(tmpProject, 'sf-lwc.lock.json')), 'Lockfile removed when empty');
    } finally {
        fs.rmSync(tmpProject, { recursive: true, force: true });
        fs.rmSync(tmpRegistry, { recursive: true, force: true });
    }
});
