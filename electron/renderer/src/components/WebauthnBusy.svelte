<script lang="ts"></script>

<!-- Shown while a native CTAP2 security-key ceremony is in flight. The native
     client first enumerates/opens the USB device (a brief wait) and then waits
     for the user's touch, so we show an animated spinner + a clear instruction
     rather than a static line, to make the wait legible (not look frozen). -->
<div class="wa-busy" data-testid="webauthn-busy" role="status" aria-live="polite">
  <span class="spinner" aria-hidden="true"></span>
  <span class="msg">Waiting for your security key… <strong>touch it</strong> when it blinks.</span>
</div>

<style>
  .wa-busy {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    padding: 8px 10px;
    border: 1px solid #3a4a63;
    border-radius: 6px;
    background: #1c2433;
    color: #8ab4f8;
    font-size: 0.9em;
  }
  .spinner {
    flex: none;
    width: 16px;
    height: 16px;
    border: 2px solid #3a4a63;
    border-top-color: #8ab4f8;
    border-radius: 50%;
    animation: wa-spin 0.8s linear infinite;
  }
  .msg { line-height: 1.3; }
  @keyframes wa-spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Respect users who prefer reduced motion — show a static dot instead. */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      border-top-color: #8ab4f8;
      border-color: #8ab4f8;
    }
  }
</style>
