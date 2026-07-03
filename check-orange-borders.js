// Script to check and add full borders to elements with orange borders
document.addEventListener('DOMContentLoaded', function() {
    console.log('Checking for elements with orange borders...');
    
    // Find all elements with inline styles containing orange border
    const allElements = document.querySelectorAll('*');
    let orangeBorderElements = [];
    
    allElements.forEach(element => {
        const style = element.getAttribute('style');
        if (style && (
            style.includes('border: 1px solid #ea580c') ||
            style.includes('border: 2px solid #ea580c') ||
            style.includes('border-color: #ea580c')
        )) {
            orangeBorderElements.push(element);
        }
    });
    
    console.log(`Found ${orangeBorderElements.length} elements with orange borders`);
    
    // Add full border to each element
    orangeBorderElements.forEach(element => {
        console.log('Adding full border to:', element);
        element.style.borderWidth = '4px';
        element.style.borderStyle = 'solid';
        element.style.borderColor = '#ea580c';
    });
    
    // Also check for elements with orange border via CSS class
    const cssOrangeElements = document.querySelectorAll('.border-orange');
    console.log(`Found ${cssOrangeElements.length} elements with .border-orange class`);
    
    cssOrangeElements.forEach(element => {
        console.log('Element with .border-orange class:', element);
        element.style.borderWidth = '4px';
        element.style.borderStyle = 'solid';
        element.style.borderColor = '#ea580c';
    });
    
    console.log('Border check complete!');
});
