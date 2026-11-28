// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@/components/Logo', () => ({ Logo: () => <span>Printly</span> }));
import OwnerWelcomePage from './page';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/owner-app');
  navigation.push.mockClear();
  navigation.replace.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('owner app introduction', () => {
  it('shows each introduction and opens the shop home after completion', () => {
    render(<OwnerWelcomePage />);
    expect(screen.getByRole('heading', { name: 'Get orders from anyone, anywhere.' })).toBeTruthy();
    expect(screen.getByLabelText('Introduction 1 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Manage everything in one place.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous introduction' }));
    expect(screen.getByRole('heading', { name: 'Get orders from anyone, anywhere.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show introduction 3' }));
    expect(screen.getByRole('heading', { name: 'Grow your print shop.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(localStorage.getItem('printly-owner-onboarding-v1')).toBe('done');
    expect(navigation.push).toHaveBeenCalledWith('/login?next=/shop');
  });

  it('lets a first-time user skip the introduction', () => {
    render(<OwnerWelcomePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(localStorage.getItem('printly-owner-onboarding-v1')).toBe('done');
    expect(navigation.push).toHaveBeenCalledWith('/login?next=/shop');
  });

  it('records a valid Android version before bypassing a completed introduction', () => {
    window.history.replaceState(null, '', '/owner-app?android_version=2');
    localStorage.setItem('printly-owner-onboarding-v1', 'done');
    render(<OwnerWelcomePage />);
    expect(localStorage.getItem('printly-owner-android-version')).toBe('2');
    expect(navigation.replace).toHaveBeenCalledWith('/login?next=/shop');
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('ignores an invalid native-version marker', () => {
    window.history.replaceState(null, '', '/owner-app?android_version=2bad');
    localStorage.setItem('printly-owner-android-version', '1');
    render(<OwnerWelcomePage />);
    expect(localStorage.getItem('printly-owner-android-version')).toBe('1');
    expect(screen.getByRole('heading', { name: 'Get orders from anyone, anywhere.' })).toBeTruthy();
  });

  it('still lets the user proceed if browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    render(<OwnerWelcomePage />);
    expect(screen.getByRole('heading', { name: 'Get orders from anyone, anywhere.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(navigation.push).toHaveBeenCalledWith('/login?next=/shop');
  });
});
