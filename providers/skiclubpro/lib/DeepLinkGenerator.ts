/**
 * DeepLinkGenerator - Creates provider deep-links for registration flows
 * Supports cache-first checklist workflow by generating direct URLs
 */

import { UrlBuilder } from './UrlBuilder.js';

export interface DeepLinkSet {
  registration_start: string;
  account_creation: string;
  program_details: string;
}

export class DeepLinkGenerator {
  private urlBuilder: UrlBuilder;
  private orgRef: string;

  constructor(orgRef: string) {
    this.orgRef = orgRef;
    this.urlBuilder = new UrlBuilder(orgRef);
  }

  /**
   * Generate registration start URL with SignupAssist ref
   */
  registrationStart(programRef: string): string {
    const base = this.urlBuilder.registration(this.orgRef, programRef);
    const params = new URLSearchParams({
      ref: 'signupassist',
      utm_source: 'chatgpt_app',
      utm_medium: 'acp',
    });
    return `${base}/start?${params}`;
  }

  /**
   * Generate account creation URL with prefill hints
   */
  accountCreation(prefillData?: { email?: string; name?: string }): string {
    const baseUrl = this.urlBuilder.login(this.orgRef).replace('/user/login', '/user/register');
    const params = new URLSearchParams({
      ref: 'signupassist',
      prefill: 'guardian',
      utm_source: 'chatgpt_app',
      ...(prefillData?.email && { email: prefillData.email }),
      ...(prefillData?.name && { name: prefillData.name })
    });
    return `${baseUrl}?${params}`;
  }

  /**
   * Generate program details page URL
   */
  programDetails(programRef: string): string {
    const base = this.urlBuilder.registration(this.orgRef, programRef);
    const params = new URLSearchParams({
      ref: 'signupassist',
      utm_source: 'chatgpt_app',
    });
    return `${base}?${params}`;
  }

  /**
   * Generate all deep-links for a program
   */
  generateAll(programRef: string): DeepLinkSet {
    return {
      registration_start: this.registrationStart(programRef),
      account_creation: this.accountCreation(),
      program_details: this.programDetails(programRef)
    };
  }
}
