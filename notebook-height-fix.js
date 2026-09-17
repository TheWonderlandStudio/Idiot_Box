// Jupyter Notebook Auto-Height Fix
// Is script ko run karne ke liye:
// 1. Notebook men koi cell select karein
// 2. Cell men %%%%javascript likhkar run karein
// ya Console men paste karein

(function() {
  'use strict';
  
  function fixCellHeights() {
    // Select all code cells
    var code_cells = document.querySelectorAll('.cm-content');
    
    code_cells.forEach(function(cell) {
      var parent = cell.parentNode.parentNode;
      if (!parent || parent.className.includes('input_area')) return;
      
      // Get the cell container
      var cellContainer = cell.closest('.cell');
      if (!cellContainer) return;
      
      // Calculate content height
      var contentHeight = cell.scrollHeight;
      
      // Add output height if present
      var output = cell.closest('.output_area');
      if (output) {
        contentHeight += output.scrollHeight + 10;
      }
      
      // Set height with buffer
      cell.style.height = 'auto';
      cell.style.minHeight = '';
      cell.style.maxHeight = 'none';
      
      // Adjust parent container
      if (parent.style) {
        parent.style.overflow = 'hidden';
      }
    });
  }
  
  // Initial fix
  fixCellHeights();
  
  // Observe for changes
  var observer = new MutationObserver(function(mutations) {
    fixCellHeights();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Also fix on resize
  window.addEventListener('resize', fixCellHeights);
  
  console.log('Jupyter Notebook auto-height fix applied');
})();